/**
 * URLs for long-lived agent server streams that carry Connect-framed
 * {@link agent.v1.AgentServerMessage} (directly or inside HealthResponse.payload).
 */
export function isAgentIncrementalStreamUrl(url: string): boolean {
  return (
    url.includes('RunSSE') ||
    url.includes('StreamBidiSSE') ||
    (url.includes('StreamBidi') && !url.includes('StreamBidiPoll'))
  );
}
