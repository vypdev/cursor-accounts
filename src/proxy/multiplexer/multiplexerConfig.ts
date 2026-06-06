import * as vscode from 'vscode';
import type { RoutingStrategyName } from '../../domain/types/multiplexerTypes';

export interface MultiplexerRoutingSettings {
  routingStrategy: RoutingStrategyName;
}

export function getMultiplexerRoutingSettings(): MultiplexerRoutingSettings {
  const config = vscode.workspace.getConfiguration('cursorAccounts.proxy.multiplexer');
  return {
    routingStrategy: config.get<RoutingStrategyName>(
      'routingStrategy',
      'workspace-path'
    ),
  };
}
