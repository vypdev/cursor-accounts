import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Session } from '../../../../domain/entities/Session';

describe('Session entity', () => {
  it('builds stable session key', () => {
    const session = new Session('127.0.0.1', 54321);
    assert.equal(session.key, '127.0.0.1:54321');
  });

  it('round-trips from key', () => {
    const session = Session.fromKey('127.0.0.1:54321');
    assert.equal(session.sourceIp, '127.0.0.1');
    assert.equal(session.sourcePort, 54321);
  });
});
