import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPortAvailable, isProcessAlive } from '../proxy/portUtils';

describe('portUtils', () => {
  it('isProcessAlive returns true for current process', () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it('isProcessAlive returns false for invalid pid', () => {
    assert.equal(isProcessAlive(999_999_999), false);
  });

  it('isPortAvailable returns false for privileged port in use', async () => {
    // Port 80 is commonly unavailable without root; use a random high port we bind
    const net = await import('net');
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port =
      typeof addr === 'object' && addr != null ? addr.port : 0;
    assert.equal(await isPortAvailable(port), false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(await isPortAvailable(port), true);
  });
});
