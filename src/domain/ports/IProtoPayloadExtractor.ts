/**
 * Port: extracts workspace path from Cursor protobuf payloads.
 * Implemented in infrastructure using existing proxy decode stack.
 */
export interface IProtoPayloadExtractor {
  extractWorkspacePath(
    payload: Uint8Array,
    url?: string,
    method?: string
  ): Promise<string | null>;
}
