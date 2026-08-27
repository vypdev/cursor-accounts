/**
 * Compatibility barrel for the agent stream, text-bucket, and token-metric
 * boundaries. Existing consumers intentionally keep importing this path.
 */

export {
  decodeAgentServerPayload,
  scanAgentServerStream,
  scanConnectFrames,
  tryConnectFrame,
} from './agent-stream-frames.mjs';
export {
  extractTextBucketsFromMessage,
  mergeTextBuckets,
} from './agent-text-buckets.mjs';
export {
  sumStreamDeltaText,
  sumUniquePrefetchedBlobChars,
} from './agent-token-metrics.mjs';
export { estimateTokensFromChars } from './ai-token-estimate.mjs';
