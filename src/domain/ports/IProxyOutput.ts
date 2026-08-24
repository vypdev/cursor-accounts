/** Output channels, log access, and tailer controls exposed to consumers. */
export interface IProxyOutput {
  getLogDirectory(): string;
  clearLogFiles(): Promise<{ deletedFiles: number; deletedBytes: number }>;
  ensureOutputTailer(
    profileId: string,
    options?: { tailFromStart?: boolean; forceRestart?: boolean }
  ): Promise<void>;
  ensureTrafficTailer(): Promise<void>;
  showOutputChannel(): void;
  showTokenDetectorChannel(): void;
}
