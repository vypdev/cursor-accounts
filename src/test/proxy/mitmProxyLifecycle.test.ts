import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Proxy } from 'http-mitm-proxy';
import {
  closeMitmProxy,
  listenToMitmProxy,
} from '../../proxy/mitmProxyLifecycle';
import type { MitmListenOptions } from '../../proxy/types';

function options(): MitmListenOptions {
  return { port: 8080, host: '127.0.0.1', sslCaDir: '/tmp/ca' };
}

function createFakeProxy(listenError?: Error): Proxy {
  return {
    listen: (
      _options: MitmListenOptions,
      callback?: (error?: Error) => void
    ): void => callback?.(listenError),
    close: (callback?: () => void): void => callback?.(),
  } as unknown as Proxy;
}

describe('mitmProxyLifecycle', () => {
  it('resolves when the callback-based listener starts successfully', async () => {
    await listenToMitmProxy(createFakeProxy(), options());
  });

  it('rejects the listener error without converting it', async () => {
    const error = new Error('listen failed');

    await assert.rejects(
      listenToMitmProxy(createFakeProxy(error), options()),
      error
    );
  });

  it('resolves when close invokes its callback', async () => {
    await closeMitmProxy(createFakeProxy(), 20);
  });

  it('resolves after the close timeout when the callback never arrives', async () => {
    const proxy = {
      close: () => undefined,
    } as unknown as Proxy;
    const startedAt = Date.now();

    await closeMitmProxy(proxy, 10);

    assert.ok(Date.now() - startedAt >= 8);
  });

  it('resolves when a broken close implementation throws', async () => {
    const proxy = {
      close: () => {
        throw new Error('close failed');
      },
    } as unknown as Proxy;

    await closeMitmProxy(proxy, 20);
  });
});
