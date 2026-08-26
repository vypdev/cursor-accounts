import * as path from 'path';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyProcess } from '../domain/ports/IProxyProcess';
import type { IProxyTrafficBus } from '../domain/ports/IProxyTrafficBus';
import type { IProxyTrafficIngress } from '../domain/ports/IProxyTrafficIngress';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProxyOutputPresenter } from '../domain/ports/IProxyOutputPresenter';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';
import type {
  ProxyTrafficDiagnostics,
  ProxyStatistics,
} from '@cursor-accounts/types';
import type * as vscode from 'vscode';
import { ProfileAuthReader } from '../auth/profileAuthReader';
import { CertificateManager } from '../proxy/certificateManager';
import { createProxyCostEnricher } from '../proxy/proxyCostEnricher';
import { ProxyTrafficBus } from '../proxy/proxyTrafficBus';
import { ProxyTrafficIngress } from '../proxy/proxyTrafficIngress';
import { getSharedProxyStorageDir } from '../proxy/sharedProxyPaths';
import { NodeProxyProcess } from '../proxy/nodeProxyProcess';
import { ProxyCertificateService } from './proxyCertificateService';
import * as extensionLog from '../logging/extensionLog';

export interface ProxyManagerDependencies {
  certService: IProxyCertificateService;
  trafficBus: IProxyTrafficBus;
  trafficIngress: IProxyTrafficIngress;
  createProcess: () => IProxyProcess;
  authReader?: IProfileAuthReader;
  /** Optional shared-state port for composition tests and alternate hosts. */
  sharedStateStore?: ISharedProxyStateStore;
}

export interface DefaultProxyManagerDependencyOptions {
  storageDir?: string;
  logDir: string;
  extensionPath: string;
  context: vscode.ExtensionContext;
  stateStore: IProxyStateStore;
  profileManager: IProfileReader;
  outputPresenter?: IProxyOutputPresenter;
  getEstimatedDollarsPerMillionTokens: () => number;
  getTailFromStart: () => boolean;
  onDiagnostics: (diagnostics: ProxyTrafficDiagnostics | undefined) => void;
}

export function createDefaultProxyManagerDependencies(
  options: DefaultProxyManagerDependencyOptions
): ProxyManagerDependencies {
  const storageDir = options.storageDir ?? getSharedProxyStorageDir();
  const certManager = new CertificateManager(path.join(storageDir, 'certs'));
  const trafficBus = new ProxyTrafficBus(
    createProxyCostEnricher(options.getEstimatedDollarsPerMillionTokens)
  );
  const trafficIngress = createTrafficIngress(options, trafficBus);
  const scriptPath = path.join(
    options.extensionPath,
    'out',
    'proxy',
    'proxyServer.js'
  );

  return {
    certService: new ProxyCertificateService(
      certManager,
      options.stateStore,
      options.profileManager
    ),
    trafficBus,
    trafficIngress,
    createProcess: () => new NodeProxyProcess(scriptPath, options.extensionPath),
    authReader: new ProfileAuthReader(options.context),
  };
}

function createTrafficIngress(
  options: DefaultProxyManagerDependencyOptions,
  trafficBus: IProxyTrafficBus
): IProxyTrafficIngress {
  return new ProxyTrafficIngress(
    options.logDir,
    trafficBus,
    options.getTailFromStart,
    {
      onLogFileResolved: (filePath) => {
        if (filePath) {
          options.outputPresenter?.appendTailing(filePath);
        }
      },
      onTailerError: (profileId, summary) => {
        extensionLog.warn(
          `[Proxy:${profileId}] ${summary.errorKind ?? 'PROXY_ERROR'}: ${summary.errorMessage ?? 'unknown error'}`
        );
      },
      onStats: (_profileId, stats: ProxyStatistics) => {
        options.onDiagnostics(stats.diagnostics);
      },
      onDiagnostics: (_profileId, lines) => {
        options.outputPresenter?.appendDiagnostics(lines);
      },
    }
  );
}
