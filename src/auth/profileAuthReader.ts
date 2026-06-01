import type * as vscode from 'vscode';
import type { CursorAuthTokens } from '@cursor-accounts/types';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import { getProfileStateDbPath } from './cursorPaths';
import { readAuthFromStateDb } from './tokenReader';

/** Reads profile auth tokens from Cursor state.vscdb via SQLite. */
export class ProfileAuthReader implements IProfileAuthReader {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async readTokens(userDataDir: string): Promise<CursorAuthTokens | null> {
    const stateDbPath = getProfileStateDbPath(userDataDir);
    return readAuthFromStateDb(stateDbPath, this.context.extensionPath);
  }
}
