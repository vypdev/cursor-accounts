import type { ProxyServerConfig } from './types';
import { createProxyServerRuntime } from './proxyServerCompositionRoot';
import { parseProxyServerConfigFromEnvironment } from './proxyServerConfigParser';

export interface ProxyServerProcessRuntime {
  start(config: ProxyServerConfig, pid: number): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ProxyServerProcessDependencies {
  parseConfig(): ProxyServerConfig;
  createRuntime(
    config: ProxyServerConfig,
    onShutdownRequested: (shutdown: Promise<void>) => void
  ): ProxyServerProcessRuntime;
  pid: number;
  on(signal: NodeJS.Signals, listener: () => void): void;
  exit(code: number): void;
  writeStderr(message: string): void;
}

const defaultDependencies: ProxyServerProcessDependencies = {
  parseConfig: () => parseProxyServerConfigFromEnvironment(),
  createRuntime: (config, onShutdownRequested) =>
    createProxyServerRuntime(
      config,
      undefined,
      undefined,
      onShutdownRequested
    ),
  pid: process.pid,
  on: (signal, listener) => {
    process.once(signal, listener);
  },
  exit: (code) => {
    process.exit(code);
  },
  writeStderr: (message) => {
    process.stderr.write(message);
  },
};

/** Runs the standalone proxy process with injectable lifecycle boundaries. */
export async function runProxyServerProcess(
  dependencies: ProxyServerProcessDependencies = defaultDependencies
): Promise<void> {
  let runtime: ProxyServerProcessRuntime | undefined;
  const exitAfterShutdown = (shutdown: Promise<void>): void => {
    void shutdown.then(
      () => dependencies.exit(0),
      () => dependencies.exit(0)
    );
  };

  try {
    const config = dependencies.parseConfig();
    runtime = dependencies.createRuntime(config, exitAfterShutdown);

    const handleTerminationSignal = (): void => {
      exitAfterShutdown(runtime!.shutdown());
    };

    // The lifecycle coordinators normally request shutdown through the API, but
    // supervisors can terminate the child directly when the API is unavailable.
    dependencies.on('SIGTERM', handleTerminationSignal);
    dependencies.on('SIGINT', handleTerminationSignal);

    await runtime.start(config, dependencies.pid);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.writeStderr(`[proxy] startup failed: ${message}\n`);
    await runtime?.shutdown();
    dependencies.exit(1);
  }
}
