import { prepareConnectPayload } from './connectDecode';
import { getProtoRegistry } from './protoRegistry';

/**
 * Extract bidi request_id from a RunSSE request body (BidiRequestId message).
 */
export async function extractBidiRequestIdFromBody(
  body: Buffer,
  contentType?: string,
  contentEncoding?: string
): Promise<string | null> {
  const isConnectProto =
    !contentType ||
    contentType.includes('connect+proto') ||
    contentType.includes('application/proto') ||
    contentType.includes('application/grpc');

  if (!isConnectProto && body.length > 64) {
    return null;
  }

  try {
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('aiserver.v1.BidiRequestId');
    if (!type) {
      return null;
    }

    for (const payload of prepareConnectPayload(body, contentEncoding)) {
      try {
        const decoded = registry.decode(type, payload) as {
          request_id?: string;
          requestId?: string;
        };
        const bidiId = decoded.request_id ?? decoded.requestId;
        if (typeof bidiId === 'string' && bidiId.length > 0) {
          return bidiId;
        }
      } catch {
        // try next payload candidate
      }
    }
  } catch {
    return null;
  }

  return null;
}
