import type { Session } from '../../../domain/entities/Session';
import type {
  ISessionStore,
  SessionBinding,
} from '../../../domain/ports/ISessionStore';

/** In-memory session and workspace → upstream mappings. */
export class InMemorySessionStore implements ISessionStore {
  private readonly sessions = new Map<string, SessionBinding>();
  private readonly workspaceMappings = new Map<string, string>();

  get(session: Session): SessionBinding | undefined {
    return this.sessions.get(session.key);
  }

  set(binding: SessionBinding): void {
    this.sessions.set(binding.sessionKey, binding);
    if (binding.workspacePath) {
      this.workspaceMappings.set(binding.workspacePath, binding.upstreamId);
    }
  }

  delete(session: Session): void {
    const existing = this.sessions.get(session.key);
    if (existing?.workspacePath) {
      this.workspaceMappings.delete(existing.workspacePath);
    }
    this.sessions.delete(session.key);
  }

  getByWorkspace(workspacePath: string): SessionBinding | undefined {
    const upstreamId = this.workspaceMappings.get(workspacePath);
    if (!upstreamId) {
      return undefined;
    }
    for (const binding of this.sessions.values()) {
      if (binding.workspacePath === workspacePath) {
        return binding;
      }
    }
    return {
      sessionKey: `workspace:${workspacePath}`,
      upstreamId,
      assignedAt: new Date(),
      workspacePath,
    };
  }

  setWorkspaceMapping(workspacePath: string, upstreamId: string): void {
    this.workspaceMappings.set(workspacePath, upstreamId);
  }

  list(): readonly SessionBinding[] {
    return [...this.sessions.values()];
  }

  clearExpired(before: Date): number {
    let removed = 0;
    for (const [key, binding] of this.sessions.entries()) {
      if (binding.assignedAt < before) {
        if (binding.workspacePath) {
          this.workspaceMappings.delete(binding.workspacePath);
        }
        this.sessions.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
