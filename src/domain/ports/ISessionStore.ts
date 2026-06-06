import type { Session } from '../entities/Session';

/** Stored session binding to an upstream. */
export interface SessionBinding {
  sessionKey: string;
  upstreamId: string;
  assignedAt: Date;
  workspacePath?: string;
}

/**
 * Port: persists client session → upstream assignments.
 */
export interface ISessionStore {
  get(session: Session): SessionBinding | undefined;
  set(binding: SessionBinding): void;
  delete(session: Session): void;
  getByWorkspace(workspacePath: string): SessionBinding | undefined;
  setWorkspaceMapping(workspacePath: string, upstreamId: string): void;
  list(): readonly SessionBinding[];
  clearExpired(before: Date): number;
}
