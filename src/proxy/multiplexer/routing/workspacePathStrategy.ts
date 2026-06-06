import { RoutingDecision } from '../../../domain/entities/RoutingDecision';
import type { Session } from '../../../domain/entities/Session';
import type { Upstream } from '../../../domain/entities/Upstream';
import type { IProfileManager } from '../../../domain/ports/IProfileManager';
import type { IProtoPayloadExtractor } from '../../../domain/ports/IProtoPayloadExtractor';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../../../domain/ports/IRoutingStrategy';
import type { ISessionStore } from '../../../domain/ports/ISessionStore';
import type { IUpstreamPool } from '../../../domain/ports/IUpstreamPool';
import type { IMultiplexerFlowLogger } from '../../../application/types/multiplexerFlowLogger';
import { decodeJwtPayload } from '../../../auth/tokenReader';
import * as extensionLog from '../../../logging/extensionLog';
import {
  filterAvailableUpstreams,
  pickRoundRobin,
} from './routingStrategyUtils';
import { StickySessionStrategy } from './stickySessionStrategy';

const BIDI_APPEND_PATH = '/aiserver.v1.BidiService/BidiAppend';

export type WorkspaceUpstreamCreator = (
  profileId: string,
  workspacePath: string
) => Promise<string>;

function workspaceRouteKey(profileId: string, workspacePath: string): string {
  return `${profileId}:${workspacePath}`;
}

/**
 * Routes by workspace path extracted from Cursor protobuf payloads.
 * Resolves profile from JWT Authorization header and creates upstreams per (profile, workspace).
 */
export class WorkspacePathStrategy implements IRoutingStrategy {
  readonly name = 'workspace-path' as const;
  private readonly workspaceToUpstream = new Map<string, string>();
  private roundRobinIndex = 0;
  private readonly fallback: StickySessionStrategy;

  constructor(
    private readonly payloadExtractor: IProtoPayloadExtractor,
    sessionStore: ISessionStore,
    private readonly onWorkspaceDiscovered?: WorkspaceUpstreamCreator,
    private readonly upstreamPool?: IUpstreamPool,
    private readonly profileManager?: IProfileManager,
    private readonly flowLogger?: IMultiplexerFlowLogger
  ) {
    this.fallback = new StickySessionStrategy(sessionStore);
  }

  async selectUpstream(
    session: Session,
    availableUpstreams: readonly Upstream[],
    context?: RoutingContext
  ): Promise<RoutingDecision> {
    const authHeader =
      context?.headers?.authorization ?? context?.headers?.Authorization;
    const { email, profileId } = await this.extractProfileIdFromToken(
      authHeader
    );
    this.flowLogger?.appendTokenExtraction(email, profileId);

    const available = filterAvailableUpstreams(availableUpstreams);
    const profileUpstreams = this.filterUpstreamsForProfile(
      available,
      profileId
    );
    const workspacePath = await this.resolveWorkspacePath(context);

    if (!workspacePath || !profileId) {
      const poolForFallback =
        profileUpstreams.length > 0 ? profileUpstreams : available;
      const fallbackDecision = this.fallback.selectUpstream(
        session,
        poolForFallback,
        context
      );
      const decision = new RoutingDecision(
        fallbackDecision.upstream,
        'workspace-path-fallback',
        {
          sessionKey: session.key,
          workspacePath: workspacePath ?? undefined,
        }
      );
      this.flowLogger?.appendRoutingDecision(
        profileId,
        workspacePath,
        decision.upstream.id,
        decision.reason
      );
      return decision;
    }

    const routeKey = workspaceRouteKey(profileId, workspacePath);
    const existingId = this.workspaceToUpstream.get(routeKey);
    if (existingId) {
      const upstream = profileUpstreams.find((u) => u.id === existingId);
      if (upstream) {
        const decision = new RoutingDecision(upstream, 'workspace-path-hit', {
          workspacePath,
          sessionKey: session.key,
        });
        this.flowLogger?.appendRoutingDecision(
          profileId,
          workspacePath,
          upstream.id,
          decision.reason
        );
        return decision;
      }
      this.workspaceToUpstream.delete(routeKey);
    }

    const existingInPool = this.upstreamPool?.getByWorkspace(
      workspacePath,
      profileId
    );
    if (existingInPool?.canAcceptConnection()) {
      this.workspaceToUpstream.set(routeKey, existingInPool.id);
      const decision = new RoutingDecision(
        existingInPool,
        'workspace-path-hit',
        {
          workspacePath,
          sessionKey: session.key,
        }
      );
      this.flowLogger?.appendRoutingDecision(
        profileId,
        workspacePath,
        existingInPool.id,
        decision.reason
      );
      return decision;
    }

    if (this.onWorkspaceDiscovered) {
      try {
        const newUpstreamId = await this.onWorkspaceDiscovered(
          profileId,
          workspacePath
        );
        this.workspaceToUpstream.set(routeKey, newUpstreamId);
        const newUpstream =
          this.upstreamPool?.getById(newUpstreamId) ??
          profileUpstreams.find((u) => u.id === newUpstreamId);
        if (newUpstream?.canAcceptConnection()) {
          const decision = new RoutingDecision(newUpstream, 'workspace-path-new', {
            workspacePath,
            sessionKey: session.key,
          });
          this.flowLogger?.appendRoutingDecision(
            profileId,
            workspacePath,
            newUpstream.id,
            decision.reason
          );
          return decision;
        }
      } catch (error) {
        extensionLog.warn(
          `[WorkspacePathStrategy] Failed to create upstream: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (profileUpstreams.length === 0) {
      throw new Error(
        `No upstream available for profile=${profileId} workspace=${workspacePath}`
      );
    }

    const picked = pickRoundRobin(profileUpstreams, this.roundRobinIndex);
    this.roundRobinIndex = picked.nextIndex;
    this.workspaceToUpstream.set(routeKey, picked.upstream.id);

    const decision = new RoutingDecision(picked.upstream, 'workspace-path-new', {
      workspacePath,
      sessionKey: session.key,
    });
    this.flowLogger?.appendRoutingDecision(
      profileId,
      workspacePath,
      picked.upstream.id,
      decision.reason
    );
    return decision;
  }

  async extractProfileIdFromToken(authHeader?: string): Promise<{
    email: string | null;
    profileId: string | null;
  }> {
    if (!authHeader || !this.profileManager) {
      return { email: null, profileId: null };
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return { email: null, profileId: null };
    }

    const payload = decodeJwtPayload(token);
    if (!payload) {
      return { email: null, profileId: null };
    }

    const email =
      typeof payload.email === 'string'
        ? payload.email
        : typeof payload.sub === 'string'
          ? payload.sub
          : null;

    if (!email) {
      return { email: null, profileId: null };
    }

    const profile = await this.profileManager.findProfileByEmail(email);
    return { email, profileId: profile?.id ?? null };
  }

  private filterUpstreamsForProfile(
    available: readonly Upstream[],
    profileId: string | null
  ): Upstream[] {
    if (!profileId || !this.upstreamPool) {
      return [...available];
    }

    const profileIds = new Set(
      this.upstreamPool
        .listByMetadata({ profileId })
        .map((upstream) => upstream.id)
    );

    return available.filter((upstream) => profileIds.has(upstream.id));
  }

  private async resolveWorkspacePath(
    context?: RoutingContext
  ): Promise<string | null> {
    if (!context?.payload || !this.shouldInspect(context.url, context.method)) {
      return null;
    }
    return this.payloadExtractor.extractWorkspacePath(
      context.payload,
      context.url,
      context.method
    );
  }

  private shouldInspect(url?: string, method?: string): boolean {
    return method === 'POST' && (url?.includes(BIDI_APPEND_PATH) ?? false);
  }
}
