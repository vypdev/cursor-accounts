import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import {
  TokenDetectorOutputPresenter,
  formatTokenDetectorLine,
} from '../ui/presentation/tokenDetectorOutputPresenter';
import type { ProxyTrafficSummary } from '../proxy/types';

type OutputChannelProbe = {
  lines: string[];
  showCalls: number;
  disposeCalls: number;
};

const originalCreateOutputChannel = vscode.window.createOutputChannel;
const originalGetConfiguration = vscode.workspace.getConfiguration;
let outputProbe: OutputChannelProbe;
let logEnabled = true;
let autoShowEnabled = false;

beforeEach(() => {
  outputProbe = { lines: [], showCalls: 0, disposeCalls: 0 };
  logEnabled = true;
  autoShowEnabled = false;
  (vscode.window as unknown as {
    createOutputChannel: () => vscode.OutputChannel;
  }).createOutputChannel = () =>
    ({
      appendLine: (line: string) => outputProbe.lines.push(line),
      append: () => undefined,
      replace: () => undefined,
      clear: () => undefined,
      show: () => {
        outputProbe.showCalls += 1;
      },
      hide: () => undefined,
      dispose: () => {
        outputProbe.disposeCalls += 1;
      },
      name: 'Token detector',
      logLevel: 0,
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }) as vscode.OutputChannel;
  (vscode.workspace as unknown as {
    getConfiguration: typeof vscode.workspace.getConfiguration;
  }).getConfiguration = (() => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      if (key === 'logTokenDetectorToOutput') {
        return logEnabled as T;
      }
      if (key === 'autoShowTokenDetectorChannel') {
        return autoShowEnabled as T;
      }
      return defaultValue;
    },
  })) as typeof vscode.workspace.getConfiguration;
});

afterEach(() => {
  vscode.window.createOutputChannel = originalCreateOutputChannel;
  vscode.workspace.getConfiguration = originalGetConfiguration;
});

describe('tokenDetectorOutputPresenter', () => {
  it('formats agent token events with conversation and request ids', () => {
    const line = formatTokenDetectorLine(
      {
        timestamp: new Date('2026-06-04T01:01:23Z').toISOString(),
        kind: 'response',
        url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
        host: 'api2.cursor.sh',
        endpoint: '/agent.v1.AgentService/RunPoll',
        rpcPath: '/agent.v1.AgentService/RunPoll',
        insights: {
          agent: {
            requestId: 'a64646d2-6f99-4227-8b3a-123456789abc',
            conversationId: 'b0f1e6a4-45ad-4060-a753-5c2f7f5c91d9',
            streamingTokens: 121,
            usageEvent: 'token_delta',
          },
          tokens: {
            modelName: 'claude-4-sonnet',
          },
        },
      } satisfies ProxyTrafficSummary,
      '74d289a7'
    );

    assert.ok(line);
    assert.match(line!, /\[TokenDetector\]/);
    assert.match(line!, /conv=b0f1e6a4-45/);
    assert.match(line!, /agent=a64646d2-6f9/);
    assert.match(line!, /stream=121/);
    assert.match(line!, /event=token_delta/);
    assert.match(line!, /model=claude-4-sonnet/);
  });

  it('returns null for unrelated traffic', () => {
    const line = formatTokenDetectorLine({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://example.com/health',
      host: 'example.com',
      endpoint: '/health',
      statusCode: 200,
    } satisfies ProxyTrafficSummary);

    assert.equal(line, null);
  });

  it('formats RunSSE token_delta from stream scan insights', () => {
    const line = formatTokenDetectorLine(
      {
        timestamp: new Date('2026-06-04T01:01:23Z').toISOString(),
        kind: 'response',
        url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
        host: 'agent.api5.cursor.sh',
        endpoint: '/agent.v1.AgentService/RunSSE',
        rpcPath: '/agent.v1.AgentService/RunSSE',
        insights: {
          agent: {
            conversationId: 'b0f1e6a4-45ad-4060-a753-5c2f7f5c91d9',
            streamingTokens: 603,
            usageEvent: 'token_delta',
          },
        },
      } satisfies ProxyTrafficSummary,
      '74d289a7'
    );

    assert.ok(line);
    assert.match(line!, /stream=603/);
    assert.match(line!, /event=token_delta/);
    assert.match(line!, /RunSSE/);
  });

  it('formats final token breakdown and session relationships', () => {
    const line = formatTokenDetectorLine(
      {
        timestamp: new Date('2026-06-04T01:01:23Z').toISOString(),
        kind: 'response',
        url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
        host: 'api2.cursor.sh',
        endpoint: '/agent.v1.AgentService/RunPoll',
        insights: {
          agent: {
            requestId: 'request-123456789',
            parentRequestId: 'parent-123456789',
            subagentRequestId: 'subagent-123456789',
            conversationGroupId: 'group-123456789',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 25,
            cacheWriteTokens: 5,
            estimatedCostUsd: 0.1256,
            eof: true,
          },
        },
      } satisfies ProxyTrafficSummary,
      'profile-123456789'
    );

    assert.ok(line);
    assert.match(line!, /profile=profile-/);
    assert.match(line!, /group=group-1234/);
    assert.match(line!, /agent=request-123/);
    assert.match(line!, /parent=parent-1/);
    assert.match(line!, /subagent=subagent-/);
    assert.match(line!, /in=100/);
    assert.match(line!, /out=50/);
    assert.match(line!, /cacheR=25/);
    assert.match(line!, /cacheW=5/);
    assert.match(line!, /~\$0\.126/);
    assert.match(line!, /eof/);
  });

  it('uses context identifiers and total token fallback when agent totals are absent', () => {
    const line = formatTokenDetectorLine({
      timestamp: new Date().toISOString(),
      kind: 'error',
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.AgentService/RunPoll',
      rpcPath: '///agent.v1.AgentService/RunPoll',
      decodeError: 'invalid frame',
      insights: {
        tokens: {
          modelName: 'gpt-4.1',
          totalTokens: 321,
        },
        context: {
          conversationId: 'conversation-123456789',
          conversationGroupId: 'context-group-123456789',
        },
      },
    } satisfies ProxyTrafficSummary);

    assert.ok(line);
    assert.match(line!, /rpc=agent\.v1\.AgentService\/RunPoll/);
    assert.doesNotMatch(line!, /← resp|→ req/);
    assert.match(line!, /conv=conversation/);
    assert.match(line!, /group=context-grou/);
    assert.match(line!, /model=gpt-4\.1/);
    assert.match(line!, /total=321/);
    assert.match(line!, /decodeErr=invalid frame/);
  });

  it('prefers agent model and keeps zero estimated cost absent', () => {
    const line = formatTokenDetectorLine({
      timestamp: new Date().toISOString(),
      kind: 'request',
      url: 'https://api2.cursor.sh/agent.v1.BidiService/BidiAppend',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.BidiService/BidiAppend',
      insights: {
        agent: {
          modelName: 'agent-model',
          estimatedCostUsd: 0,
          usageEvent: 'token_details',
        },
        tokens: {
          modelName: 'token-model',
        },
      },
    } satisfies ProxyTrafficSummary);

    assert.ok(line);
    assert.match(line!, /model=token-model/);
    assert.doesNotMatch(line!, /agent-model/);
    assert.doesNotMatch(line!, /~\$/);
    assert.match(line!, /event=token_details/);
    assert.match(line!, /→ req/);
  });

  it('does not emit an empty line for an agent RPC without useful insights', () => {
    const line = formatTokenDetectorLine({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.AgentService/RunPoll',
    } satisfies ProxyTrafficSummary);

    assert.equal(line, null);
  });

  it('controls the VS Code output channel and auto-show behavior', () => {
    const presenter = new TokenDetectorOutputPresenter();

    presenter.appendInitialized('profile-123456789');
    presenter.appendNote('tracking started');
    presenter.appendTraffic({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.AgentService/RunPoll',
      insights: { agent: { requestId: 'request-123456789' } },
    } satisfies ProxyTrafficSummary);

    assert.equal(outputProbe.lines.length, 3);
    assert.match(outputProbe.lines[0]!, /profile-/);
    assert.match(outputProbe.lines[1]!, /tracking started/);
    assert.match(outputProbe.lines[2]!, /agent=request-123/);
    assert.equal(outputProbe.showCalls, 0);

    presenter.show();
    presenter.dispose();
    assert.equal(outputProbe.showCalls, 1);
    assert.equal(outputProbe.disposeCalls, 1);
  });

  it('logs one auto-show request for the first useful traffic line', () => {
    autoShowEnabled = true;
    const presenter = new TokenDetectorOutputPresenter();
    const summary = {
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.AgentService/RunPoll',
      insights: { agent: { requestId: 'request-123456789' } },
    } satisfies ProxyTrafficSummary;

    presenter.appendTraffic(summary);
    presenter.appendTraffic(summary);

    assert.equal(outputProbe.lines.length, 2);
    assert.equal(outputProbe.showCalls, 1);
  });

  it('does not write when token detector logging is disabled', () => {
    logEnabled = false;
    const presenter = new TokenDetectorOutputPresenter();

    presenter.appendNote('hidden');
    presenter.appendTraffic({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.AgentService/RunPoll',
      insights: { agent: { requestId: 'request-123456789' } },
    } satisfies ProxyTrafficSummary);

    assert.equal(outputProbe.lines.length, 0);
    assert.equal(outputProbe.showCalls, 0);
  });
});
