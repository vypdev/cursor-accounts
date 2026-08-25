#!/usr/bin/env node
/**
 * Standalone MITM proxy child process entry point.
 * Started via child_process.fork() from ProxyManager.
 *
 * Exposes a localhost HTTP/WebSocket API on `config.apiPort` so any extension
 * host window can consume traffic and control lifecycle without IPC.
 */
import { runProxyServerProcess } from './proxyServerProcess';

export { createProxyServerRuntime } from './proxyServerCompositionRoot';
export { parseProxyServerConfig } from './proxyServerConfigParser';

if (require.main === module) {
  void runProxyServerProcess();
}
