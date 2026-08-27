import '../registerVscodeMock';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { initL10nForTests } from '../../l10n';
import {
  getModelEfficiencyConfig,
  OutputPresenter,
} from '../../modelEfficiency/outputPresenter';
import type { PromptMetadata, ScoringResult } from '../../modelEfficiency/types';

type OutputChannelProbe = {
  lines: string[];
  showCalls: number;
  disposeCalls: number;
};

const originalCreateOutputChannel = vscode.window.createOutputChannel;
const originalGetConfiguration = vscode.workspace.getConfiguration;
const originalShowInformationMessage = (
  vscode.window as unknown as {
    showInformationMessage?: (
      message: string,
      ...items: string[]
    ) => Promise<string | undefined>;
  }
).showInformationMessage;

let outputProbe: OutputChannelProbe;
let notifications: string[];
let notificationAction: string | undefined;
let settings = {
  showNotificationOnHigh: true,
  autoShowOutputChannel: false,
};

const RESULT: ScoringResult = {
  promptExcerpt: 'Explain this function',
  selectedModel: 'model-a',
  taskType: 'explanation',
  requiredTier: 1,
  actualTier: 2,
  efficiencyScore: 0.8,
  severity: 'low',
  opinion: 'The selected model is suitable.',
  recommendedModel: 'model-a',
  confidence: 0.9,
  scoredAt: 200,
};

const METADATA: PromptMetadata = {
  timestamp: 100,
  prompt: 'Explain this function',
  model: 'model-a',
  attachments: [],
  conversationId: 'conversation-a',
  workspaceRoots: ['/workspace'],
};

beforeEach(() => {
  initL10nForTests({
    'efficiency.output.channelName': 'Model Efficiency',
    'efficiency.output.errorTitle': 'Analysis error',
    'efficiency.output.promptLabel': 'Prompt:',
    'efficiency.output.modelLabel': 'Model:',
    'efficiency.output.errorLabel': 'Error:',
    'efficiency.output.analysisTitle': 'Model efficiency analysis',
    'efficiency.output.selectedModel': 'Selected model: {model}',
    'efficiency.output.taskType': 'Task type: {type}',
    'efficiency.output.efficiencyScore': 'Efficiency score: {score}%',
    'efficiency.output.severity': 'Severity: {severity}',
    'efficiency.output.confidence': 'Confidence: {confidence}%',
    'efficiency.output.notice': 'Notice: {opinion}',
    'efficiency.output.recommendation': 'Recommendation: {model}',
    'efficiency.output.modelAdequate': 'The selected model is adequate.',
    'efficiency.output.inefficientNotification': 'Inefficient model: {opinion}',
    'efficiency.output.viewDetails': 'View details',
  });
  outputProbe = { lines: [], showCalls: 0, disposeCalls: 0 };
  notifications = [];
  notificationAction = undefined;
  settings = {
    showNotificationOnHigh: true,
    autoShowOutputChannel: false,
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
      name: 'Model Efficiency',
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

  (vscode.window as unknown as {
    showInformationMessage: (
      message: string,
      ...items: string[]
    ) => Promise<string | undefined>;
  }).showInformationMessage = async (message, ..._items) => {
    notifications.push(message);
    return notificationAction;
  };
});

afterEach(() => {
  vscode.window.createOutputChannel = originalCreateOutputChannel;
  vscode.workspace.getConfiguration = originalGetConfiguration;
  (vscode.window as unknown as {
    showInformationMessage?: (
      message: string,
      ...items: string[]
    ) => Promise<string | undefined>;
  }).showInformationMessage = originalShowInformationMessage;
});

describe('OutputPresenter', () => {
  it('reads model-efficiency settings through the VS Code boundary', () => {
    settings = {
      showNotificationOnHigh: false,
      autoShowOutputChannel: true,
    };

    assert.deepEqual(getModelEfficiencyConfig(), settings);
  });

  it('presents an adequate result and auto-shows the output channel when configured', () => {
    settings.autoShowOutputChannel = true;
    const presenter = new OutputPresenter();

    presenter.present(RESULT, METADATA);

    assert.equal(outputProbe.showCalls, 1);
    assert.equal(notifications.length, 0);
    assert.ok(outputProbe.lines.some((line) => line.includes('adequate')));
    assert.ok(outputProbe.lines.some((line) => line.includes('80%')));
  });

  it('presents errors with and without prompt metadata', () => {
    const presenter = new OutputPresenter();

    presenter.appendStatus('Analyzing');
    presenter.presentError('Classifier unavailable', METADATA);
    presenter.presentError('Classifier unavailable');

    assert.equal(outputProbe.lines.length, 13);
    assert.ok(outputProbe.lines.some((line) => line.includes('Analyzing')));
    assert.ok(outputProbe.lines.some((line) => line.includes('model-a')));
    assert.equal(
      outputProbe.lines.filter((line) => line.includes('Classifier unavailable'))
        .length,
      2
    );
  });

  it('notifies for an inefficient high-severity result and opens details when selected', async () => {
    notificationAction = 'View details';
    const presenter = new OutputPresenter();

    presenter.present(
      {
        ...RESULT,
        efficiencyScore: 0.5,
        severity: 'high',
        opinion: 'Use a smaller model.',
        recommendedModel: 'model-small',
      },
      METADATA
    );
    await Promise.resolve();

    assert.deepEqual(notifications, ['Inefficient model: Use a smaller model.']);
    assert.equal(outputProbe.showCalls, 1);
    assert.ok(outputProbe.lines.some((line) => line.includes('model-small')));
  });

  it('does not open the output channel when the notification action is dismissed', async () => {
    const presenter = new OutputPresenter();

    presenter.present(
      { ...RESULT, efficiencyScore: 0.5, severity: 'high' },
      METADATA
    );
    await Promise.resolve();

    assert.equal(notifications.length, 1);
    assert.equal(outputProbe.showCalls, 0);
  });

  it('shows and disposes the output channel explicitly', () => {
    const presenter = new OutputPresenter();

    presenter.show();
    presenter.dispose();

    assert.equal(outputProbe.showCalls, 1);
    assert.equal(outputProbe.disposeCalls, 1);
  });
});
