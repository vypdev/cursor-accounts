import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FromWebviewMessage, ToWebviewMessage } from '../profiles/types';
import {
  AccountsPanelMessageRouter,
  type AccountsPanelActionMessage,
} from '../ui/accountsPanelMessageRouter';

function createRouter() {
  const events: string[] = [];
  const posted: ToWebviewMessage[] = [];
  const actions: AccountsPanelActionMessage[] = [];
  const router = new AccountsPanelMessageRouter(
    {
      setRuntimeReady: () => {
        events.push('ready');
      },
      refresh: async () => {
        events.push('refresh');
      },
      handleAction: async (message) => {
        actions.push(message);
      },
      requestModelPricing: async () => {
        events.push('pricing');
      },
      postMessage: async (message) => {
        posted.push(message);
      },
    },
    {
      delay: async (milliseconds) => {
        events.push(`delay:${milliseconds}`);
      },
    }
  );

  return { router, events, posted, actions };
}

describe('AccountsPanelMessageRouter', () => {
  it('marks the runtime ready before delaying and refreshing', async () => {
    const { router, events } = createRouter();

    await router.handle({ type: 'ready' });

    assert.deepEqual(events, ['ready', 'delay:150', 'refresh']);
  });

  it('routes lifecycle refresh and pricing messages to their callbacks', async () => {
    const { router, events } = createRouter();

    await router.handle({ type: 'requestInit' });
    await router.handle({ type: 'refresh' });
    await router.handle({ type: 'requestModelPricing' });

    assert.deepEqual(events, ['refresh', 'refresh', 'pricing']);
  });

  it('routes action messages without interpreting their payload', async () => {
    const { router, actions } = createRouter();
    const message: AccountsPanelActionMessage = {
      type: 'refreshProxyStatus',
    };

    await router.handle(message);

    assert.deepEqual(actions, [message]);
  });

  it('converts handler failures into an error webview message', async () => {
    const { posted } = createRouter();
    const router = new AccountsPanelMessageRouter({
      setRuntimeReady: () => undefined,
      refresh: async () => {
        throw new Error('refresh failed');
      },
      handleAction: async () => undefined,
      requestModelPricing: async () => undefined,
      postMessage: async (message) => {
        posted.push(message);
      },
    });

    await router.handle({ type: 'refresh' });

    assert.deepEqual(posted, [{ type: 'error', message: 'refresh failed' }]);
  });

  it('ignores webview logging messages after forwarding their payload', async () => {
    const { router, posted, events } = createRouter();

    await router.handle({
      type: 'webviewLog',
      level: 'info',
      phase: 'test',
      message: 'hello',
    });

    assert.deepEqual(posted, []);
    assert.deepEqual(events, []);
  });

  it('does not route unknown runtime messages as actions', async () => {
    const { router, actions, posted } = createRouter();

    await router.handle({ type: 'unknown' } as unknown as FromWebviewMessage);

    assert.deepEqual(actions, []);
    assert.deepEqual(posted, []);
  });
});
