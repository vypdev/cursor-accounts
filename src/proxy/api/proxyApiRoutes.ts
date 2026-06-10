import type { Express, Request, Response } from 'express';
import type { ProxyStatistics } from '@cursor-accounts/types';
import {
  PROXY_API_PATHS,
  type ProxyApiHealthResponse,
  type ProxyApiServerOptions,
  type ProxyApiStatusResponse,
} from '../../application/types/proxyApi';
import { PROXY_STATE_SCHEMA_VERSION } from '../types';

export interface ProxyApiRouteContext {
  getStatus: () => ProxyApiStatusResponse;
  getStatistics: () => ProxyStatistics;
  requestShutdown: () => void;
}

export function registerProxyApiRoutes(
  app: Express,
  options: ProxyApiServerOptions
): ProxyApiRouteContext {
  const startedAtMs = Date.parse(options.startedAt);

  const getStatus = (): ProxyApiStatusResponse => ({
    running: true,
    mitmPort: options.mitmPort,
    apiPort: options.apiPort,
    profileId: options.profileId,
    pid: options.pid,
    startedAt: options.startedAt,
    uptimeMs: Number.isFinite(startedAtMs)
      ? Math.max(0, Date.now() - startedAtMs)
      : undefined,
  });

  const getStatistics = (): ProxyStatistics => options.getStatistics();

  const requestShutdown = (): void => {
    options.onShutdownRequested?.();
  };

  app.get(
    PROXY_API_PATHS.health,
    (_req: Request, res: Response<ProxyApiHealthResponse>) => {
      res.json({ ok: true, version: PROXY_STATE_SCHEMA_VERSION });
    }
  );

  app.get(
    PROXY_API_PATHS.status,
    (_req: Request, res: Response<ProxyApiStatusResponse>) => {
      res.json(getStatus());
    }
  );

  app.get(
    PROXY_API_PATHS.stats,
    (_req: Request, res: Response<ProxyStatistics>) => {
      res.json(getStatistics());
    }
  );

  app.post(PROXY_API_PATHS.shutdown, (_req: Request, res: Response) => {
    requestShutdown();
    res.json({ success: true });
  });

  return { getStatus, getStatistics, requestShutdown };
}
