/** A workspace folder opened under a profile's user data directory. */
export interface WorkspaceInfo {
  /** Absolute folder or workspace file path (from file:// URI). */
  path: string;
  /** Display name (basename of path). */
  name: string;
  /** ISO timestamp from workspace storage directory mtime. */
  lastModified: string;
  /** Hash folder name under workspaceStorage. */
  storageHash: string;
  /** True when this project is open in the active Cursor window session. */
  isOpenInSession?: boolean;
}
