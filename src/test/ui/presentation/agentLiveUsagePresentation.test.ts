import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAgentLiveUsageDisplay,
  type AgentLiveUsageDisplay,
} from '../../../ui/presentation/agentLiveUsagePresentation';
import type { AgentLiveUsageSessionState } from '../../../application/services/agentLiveUsageState';

function session(
  overrides: Partial<AgentLiveUsageSessionState> = {}
): AgentLiveUsageSessionState {
  return {
    agent: {},
    liveAccumulated: 0,
    liveAccumulatedCostCents: 0,
    billedTokens: 0,
    lastActivity: 123,
    ...overrides,
  };
}

function visibleDisplay(
  display: AgentLiveUsageDisplay
): Extract<AgentLiveUsageDisplay, { visible: true }> {
  assert.equal(display.visible, true);
  return display as Extract<AgentLiveUsageDisplay, { visible: true }>;
}

describe('agent live usage presentation', () => {
  it('hides disabled or empty usage state', () => {
    assert.deepEqual(
      buildAgentLiveUsageDisplay(new Map(), false),
      { visible: false }
    );
    assert.deepEqual(
      buildAgentLiveUsageDisplay(new Map([['session-a', session()]]), true),
      { visible: false }
    );
  });

  it('renders live token count and estimated cost', () => {
    const display = visibleDisplay(
      buildAgentLiveUsageDisplay(
        new Map([
          [
            'session-a',
            session({ liveAccumulated: 2500, liveAccumulatedCostCents: 1 }),
          ],
        ]),
        true
      )
    );

    assert.equal(display.text, '$(symbol-event) 2.5k · ~$0.01');
    assert.match(display.tooltip, /Tokens \(displayed\): 2500/);
    assert.match(display.tooltip, /Live cost: ~\$0\.01/);
  });

  it('marks server-reported turn cost as authoritative', () => {
    const display = visibleDisplay(
      buildAgentLiveUsageDisplay(
        new Map([
          [
            'session-a',
            session({
              billedTokens: 1500,
              turnTotalCents: 80,
              turnCostFromServer: true,
              agent: { inputTokens: 1200, outputTokens: 300 },
            }),
          ],
        ]),
        true
      )
    );

    assert.equal(display.text, '$(symbol-event) 1.5k · $0.80');
    assert.match(display.tooltip, /Turn cost from server \(total_cents\)/);
    assert.match(display.tooltip, /Turn ended — input: 1200, output: 300/);
  });

  it('aggregates sessions and identifies the estimated cost when no server total exists', () => {
    const display = visibleDisplay(
      buildAgentLiveUsageDisplay(
        new Map([
          ['session-a', session({ liveAccumulated: 100, liveAccumulatedCostCents: 0.5 })],
          [
            'session-b',
            session({
              billedTokens: 200,
              turnTotalCents: 50,
              turnCostFromServer: false,
            }),
          ],
        ]),
        true
      )
    );

    assert.equal(display.text, '$(symbol-event) 200 · ~$0.50');
    assert.match(display.tooltip, /Active sessions: 2/);
    assert.match(display.tooltip, /Cost is a rough estimate/);
  });
});
