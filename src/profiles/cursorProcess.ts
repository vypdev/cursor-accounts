/** Raw Cursor process info from OS inspection. */
export interface CursorProcess {
  pid: number;
  userDataDir?: string;
  projectPath?: string;
  startTime?: number;
}
