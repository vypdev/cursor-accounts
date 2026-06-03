import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bidiDataToBuffer,
  bidiInnerRoleForRpc,
  decodeBidiAgentPayload,
  isBidiCarrierRpc,
} from '../proxy/bidiAgentDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../proxy/protoRegistry';

describe('bidiAgentDecode', () => {
  it('detects bidi RPC paths and inner roles', () => {
    assert.equal(isBidiCarrierRpc('/agent.v1.AgentService/RunPoll'), true);
    assert.equal(
      bidiInnerRoleForRpc('/agent.v1.AgentService/RunPoll', 'response'),
      'server'
    );
    assert.equal(
      bidiInnerRoleForRpc('/aiserver.v1.BidiService/BidiAppend', 'request'),
      'client'
    );
  });

  it('parses hex data fields', () => {
    const buf = bidiDataToBuffer('0a026a00', undefined);
    assert.ok(buf);
    assert.equal(buf.toString('hex'), '0a026a00');
  });

  it('decodes AgentServerMessage from RunPoll response hex', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const inner = decodeBidiAgentPayload(
      registry,
      '0a026a00',
      undefined,
      'server'
    );
    assert.ok(inner);
  });
});
