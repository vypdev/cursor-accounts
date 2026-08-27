import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import {
  CURSOR_PROTO_FILES,
  loadCursorProtos,
} from './lib/cursor-proto-runtime.mjs';

describe('Cursor proto runtime', () => {
  it('resolves the checked-in proto files and loads their root', async () => {
    assert.equal(CURSOR_PROTO_FILES.length, 2);
    for (const protoFile of CURSOR_PROTO_FILES) {
      assert.equal(fs.existsSync(protoFile), true);
    }

    const root = await loadCursorProtos();
    assert.ok(root.lookup('agent.v1'));
    assert.ok(root.lookup('aiserver.v1'));
  });
});
