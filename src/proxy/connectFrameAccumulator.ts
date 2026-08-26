import { tryConnectFrame } from './agentStreamDecode';

const MAX_CONNECT_FRAME_BYTES = 5_000_000;

/**
 * Incrementally extracts complete Connect-RPC payloads from response chunks.
 * The accumulator does not decode or interpret payload contents.
 */
export class ConnectFrameAccumulator {
  private buffer = Buffer.alloc(0);

  feed(chunk: Buffer): Buffer[] {
    if (chunk.length === 0) {
      return [];
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    const payloads: Buffer[] = [];
    let offset = 0;
    while (offset < this.buffer.length) {
      const frame = tryConnectFrame(this.buffer, offset);
      if (!frame) {
        if (this.isIncompleteFrameAt(offset)) {
          break;
        }
        offset += 1;
        continue;
      }

      payloads.push(frame.payload);
      offset = frame.nextOffset;
    }

    this.buffer = offset > 0 ? this.buffer.subarray(offset) : this.buffer;
    return payloads;
  }

  get bufferedLength(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  private isIncompleteFrameAt(offset: number): boolean {
    if (offset + 5 > this.buffer.length) {
      return true;
    }

    const length = this.buffer.readUInt32BE(offset + 1);
    return (
      length > 0 &&
      length <= MAX_CONNECT_FRAME_BYTES &&
      offset + 5 + length > this.buffer.length
    );
  }
}
