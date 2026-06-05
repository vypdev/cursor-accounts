import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldLogMitmClientError } from '../../proxy/mitmClientErrorFilter';

describe('shouldLogMitmClientError', () => {
  it('suppresses certificate unknown alerts', () => {
    assert.equal(
      shouldLogMitmClientError(
        'HTTPS_CLIENT_ERROR',
        'SSLV3_ALERT_CERTIFICATE_UNKNOWN'
      ),
      false
    );
  });

  it('suppresses HTTP parse noise on MITM leg', () => {
    assert.equal(
      shouldLogMitmClientError(
        'HTTPS_CLIENT_ERROR',
        'Parse Error: Invalid character in chunk size'
      ),
      false
    );
  });

  it('keeps other proxy errors', () => {
    assert.equal(
      shouldLogMitmClientError('PROXY_ERROR', 'something else'),
      true
    );
  });
});
