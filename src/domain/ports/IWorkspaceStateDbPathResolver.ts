/**
 * Resolves the workspace-scoped Cursor `state.vscdb` path for the active window.
 */
export interface IWorkspaceStateDbPathResolver {
  /** Absolute path to `{workspaceStorage}/{hash}/state.vscdb`, or null when unavailable. */
  resolve(): string | null;
}
