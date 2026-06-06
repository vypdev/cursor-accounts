import * as vscode from 'vscode';
import type { IMultiplexerManager } from '../domain/ports/IMultiplexerManager';
import type { RoutingStrategyName } from '../domain/types/multiplexerTypes';
import { t } from '../l10n';
import { getMultiplexerRoutingSettings } from '../proxy/multiplexer/multiplexerConfig';
import type { ProfileMultiplexerService } from '../services/profileMultiplexerService';

export function registerMultiplexerCommands(
  context: vscode.ExtensionContext,
  multiplexerManager: IMultiplexerManager,
  onStatusChanged?: () => void
): void {
  multiplexerManager.onStatusChange(() => {
    onStatusChanged?.();
  });

  const profileMux = multiplexerManager as ProfileMultiplexerService;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cursorAccounts.proxy.multiplexer.start',
      async () => {
        const settings = getMultiplexerRoutingSettings();
        const result = await multiplexerManager.start({
          routing: {
            strategy: settings.routingStrategy,
            fallbackStrategy: 'sticky-session',
          },
        });
        if (result.success) {
          vscode.window.showInformationMessage(
            t('commands.multiplexer.started', {
              port: String(result.port ?? ''),
            })
          );
        } else {
          vscode.window.showErrorMessage(
            t('commands.multiplexer.startFailed', {
              error: result.error ?? t('errors.unknown'),
            })
          );
        }
      }
    ),

    vscode.commands.registerCommand(
      'cursorAccounts.proxy.multiplexer.stop',
      async () => {
        await multiplexerManager.stop();
        vscode.window.showInformationMessage(t('commands.multiplexer.stopped'));
      }
    ),

    vscode.commands.registerCommand(
      'cursorAccounts.proxy.multiplexer.status',
      async () => {
        const status = await multiplexerManager.buildStatusView();
        const lines = [
          `Router: ${status.running ? 'running' : 'stopped'}`,
          status.port != null ? `Port: ${status.port}` : null,
          status.strategy ? `Strategy: ${status.strategy}` : null,
          `Upstreams: ${status.upstreamCount}`,
          `Active sessions: ${status.activeSessions}`,
        ].filter((line): line is string => line != null);
        await vscode.window.showInformationMessage(lines.join(' | '));
      }
    ),

    vscode.commands.registerCommand(
      'cursorAccounts.proxy.multiplexer.metrics',
      async () => {
        const metrics = await multiplexerManager.getMetrics();
        if (!metrics) {
          vscode.window.showWarningMessage(t('commands.multiplexer.notRunning'));
          return;
        }
        const lines = Object.entries(metrics.snapshot.upstreamMetrics).map(
          ([id, value]) =>
            `${id}: requests=${value.requests}, connections=${value.activeConnections}`
        );
        await vscode.window.showInformationMessage(lines.join(' | ') || 'No metrics');
      }
    ),

    vscode.commands.registerCommand(
      'cursorAccounts.proxy.multiplexer.setStrategy',
      async () => {
        const pick = await vscode.window.showQuickPick(
          [
            { label: 'Sticky Session', value: 'sticky-session' as const },
            { label: 'Token Hash', value: 'token-hash' as const },
            { label: 'Round Robin', value: 'round-robin' as const },
            { label: 'Least Connections', value: 'least-connections' as const },
            { label: 'Workspace Path', value: 'workspace-path' as const },
            { label: 'Hybrid', value: 'hybrid' as const },
          ],
          { placeHolder: t('commands.multiplexer.chooseStrategy') }
        );
        if (!pick) {
          return;
        }
        const result = await multiplexerManager.setStrategy(
          pick.value as RoutingStrategyName
        );
        if (result.success) {
          vscode.window.showInformationMessage(
            t('commands.multiplexer.strategySet', { strategy: pick.label })
          );
        } else {
          vscode.window.showErrorMessage(
            t('commands.multiplexer.strategyFailed', {
              error: result.error ?? t('errors.unknown'),
            })
          );
        }
      }
    ),

    vscode.commands.registerCommand(
      'cursorAccounts.proxy.multiplexer.sessions',
      async () => {
        const sessions = await profileMux.getSessionsForCurrentProfile();
        if (sessions.length === 0) {
          vscode.window.showInformationMessage(t('commands.multiplexer.noSessions'));
          return;
        }
        const preview = sessions
          .slice(0, 5)
          .map((session) => `${session.sessionKey} -> ${session.upstreamId}`)
          .join('\n');
        await vscode.window.showInformationMessage(preview);
      }
    )
  );
}
