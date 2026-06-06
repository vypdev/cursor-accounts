/** Optional logger for multiplexor flow events in the MITM output channel. */
export interface IMultiplexerFlowLogger {
  appendMultiplexerStarted(port: number): void;
  appendMultiplexerStopped(): void;
  appendUpstreamCreated(
    upstreamId: string,
    profileId: string,
    workspace: string,
    port: number
  ): void;
  appendUpstreamStopped(upstreamId: string): void;
  appendRoutingDecision(
    profileId: string | null,
    workspace: string | null,
    upstreamId: string,
    reason: string
  ): void;
  appendTokenExtraction(email: string | null, profileId: string | null): void;
  appendSettingsModified(userDataDir: string, proxyUrl: string): void;
  appendSettingsRestored(userDataDir: string): void;
}
