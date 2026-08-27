import './registerVscodeMock';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { initL10nForTests } from '../l10n';
import {
  getProxyOutputConfig,
  ProxyOutputPresenter,
} from '../ui/presentation/proxyOutputPresenter';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';

type OutputChannelProbe = {
  lines: string[];
  showCalls: number;
  disposeCalls: number;
};

const originalCreateOutputChannel = vscode.window.createOutputChannel;
const originalGetConfiguration = vscode.workspace.getConfiguration;
let outputProbe: OutputChannelProbe;
let settings = {
  logTrafficToOutput: true,
  autoShowOutputChannel: false,
  outputCursorHostsOnly: false,
};

function trafficSummary(
  overrides: Partial<ProxyTrafficSummary> = {}
): ProxyTrafficSummary {
  return {
    timestamp: '2026-06-04T01:01:23.000Z',
    kind: 'response',
    url: 'https://api2.cursor.sh/agent',
    host: 'api2.cursor.sh',
    endpoint: '/agent',
    statusCode: 200,
    bodyKind: 'proto',
    bodyBytes: 42,
    isCursorHost: true,
    ...overrides,
  };
}

beforeEach(() => {
  initL10nForTests({
    'proxy.output.channelName': 'Cursor MITM Proxy',
    'proxy.output.started': 'Proxy started on 127.0.0.1:{port}',
    'proxy.output.attached': 'Attached to proxy on 127.0.0.1:{port}',
    'proxy.output.tailing': 'Tailing log file: {path}',
    'proxy.output.logDisabled': 'Traffic output logging is disabled',
    'proxy.output.stopped': 'Proxy stopped',
  });
  outputProbe = { lines: [], showCalls: 0, disposeCalls: 0 };
  settings = {
    logTrafficToOutput: true,
    autoShowOutputChannel: false,
    outputCursorHostsOnly: false,
  };

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
      name: 'Cursor MITM Proxy',
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
      if (key in settings) {
        return settings[key as keyof typeof settings] as T;
      }
      return defaultValue;
    },
  })) as typeof vscode.workspace.getConfiguration;
});

afterEach(() => {
  vscode.window.createOutputChannel = originalCreateOutputChannel;
  vscode.workspace.getConfiguration = originalGetConfiguration;
});

describe('ProxyOutputPresenter', () => {
  it('reads the proxy output settings through the VS Code configuration boundary', () => {
    settings = {
      logTrafficToOutput: false,
      autoShowOutputChannel: true,
      outputCursorHostsOnly: true,
    };

    assert.deepEqual(getProxyOutputConfig(), settings);
  });

  it('writes lifecycle and diagnostic messages and controls the channel', () => {
    const presenter = new ProxyOutputPresenter();

    presenter.appendStarted(8080);
    presenter.appendAttached(8081);
    presenter.appendTailing('/tmp/proxy.jsonl');
    presenter.appendLogDisabled();
    presenter.appendStopped();
    presenter.appendDiagnostics([]);
    presenter.appendDiagnostics(['[ProxyDiagnostics] requests=4', 'bypassed=1']);

    assert.equal(outputProbe.lines.length, 14);
    assert.match(outputProbe.lines[0]!, /Proxy started.*8080/);
    assert.match(outputProbe.lines[2]!, /Attached.*8081/);
    assert.match(outputProbe.lines[4]!, /Tailing.*proxy\.jsonl/);
    assert.match(outputProbe.lines[6]!, /logging is disabled/);
    assert.match(outputProbe.lines[8]!, /Proxy stopped/);
    assert.match(outputProbe.lines[11]!, /requests=4/);
    assert.match(outputProbe.lines[12]!, /bypassed=1/);
    assert.equal(outputProbe.showCalls, 0);

    presenter.show();
    presenter.dispose();

    assert.equal(outputProbe.showCalls, 1);
    assert.equal(outputProbe.disposeCalls, 1);
  });

  it('filters traffic and auto-shows only the first accepted traffic line', () => {
    settings.autoShowOutputChannel = true;
    settings.outputCursorHostsOnly = true;
    const presenter = new ProxyOutputPresenter();

    presenter.appendTraffic(trafficSummary({ isCursorHost: false }));
    presenter.appendTraffic(
      trafficSummary({ insights: { agent: { requestId: 'req12345678' } } })
    );
    presenter.appendTraffic(
      trafficSummary({ insights: { agent: { requestId: 'req87654321' } } })
    );

    assert.equal(outputProbe.lines.length, 2);
    assert.match(outputProbe.lines[0]!, /agent=req12345/);
    assert.match(outputProbe.lines[1]!, /agent=req87654/);
    assert.equal(outputProbe.showCalls, 1);
  });

  it('does not write traffic when output logging is disabled', () => {
    settings.logTrafficToOutput = false;
    const presenter = new ProxyOutputPresenter();

    presenter.appendTraffic(trafficSummary());
    presenter.appendError(trafficSummary({ kind: 'error', errorKind: 'FAILURE' }));

    assert.deepEqual(outputProbe.lines, []);
    assert.equal(outputProbe.showCalls, 0);
  });

  it('writes errors for allowed hosts and shows each error when configured', () => {
    settings.autoShowOutputChannel = true;
    settings.outputCursorHostsOnly = true;
    const presenter = new ProxyOutputPresenter();

    presenter.appendError(
      trafficSummary({
        kind: 'error',
        isCursorHost: false,
        errorKind: 'FILTERED',
        errorMessage: 'ignored',
      })
    );
    presenter.appendError(
      trafficSummary({
        kind: 'error',
        errorKind: 'SOCKET_CLOSED',
        errorMessage: 'socket closed',
      })
    );
    presenter.appendError(
      trafficSummary({
        kind: 'error',
        isCursorHost: undefined,
        errorKind: 'UNKNOWN_HOST_FLAG',
        errorMessage: 'still allowed',
      })
    );

    assert.equal(outputProbe.lines.length, 2);
    assert.match(outputProbe.lines[0]!, /socket closed/);
    assert.match(outputProbe.lines[1]!, /still allowed/);
    assert.equal(outputProbe.showCalls, 2);
  });
});
