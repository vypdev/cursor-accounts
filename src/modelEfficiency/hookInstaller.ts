import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { getEfficiencyMetadataDir } from './paths';

const HOOK_SCRIPT_NAME = 'capture-prompt.js';
const HOOK_MARKER = 'capture-prompt.js';

interface HooksConfig {
  version?: number;
  hooks?: Record<string, HookEntry[]>;
}

interface HookEntry {
  command?: string;
  timeout?: number;
  matcher?: string;
  env?: Record<string, string>;
}

function getHooksFilePath(): string {
  return path.join(os.homedir(), '.cursor', 'hooks.json');
}

export function getHookScriptPath(extensionPath: string): string {
  return path.join(extensionPath, 'out', 'hooks', HOOK_SCRIPT_NAME);
}

export async function isEfficiencyHookInstalled(
  extensionPath: string
): Promise<boolean> {
  const scriptPath = getHookScriptPath(extensionPath);
  try {
    const hooksPath = getHooksFilePath();
    const raw = await fs.readFile(hooksPath, 'utf8');
    const config = JSON.parse(raw) as HooksConfig;
    const entries = config.hooks?.beforeSubmitPrompt ?? [];
    return entries.some(
      (entry) =>
        entry.command?.includes(HOOK_MARKER) ||
        entry.command?.includes(scriptPath)
    );
  } catch {
    return false;
  }
}

export async function installEfficiencyHook(
  context: vscode.ExtensionContext
): Promise<void> {
  const hooksPath = getHooksFilePath();
  const scriptPath = getHookScriptPath(context.extensionPath);
  const metadataDir = getEfficiencyMetadataDir(context);

  await fs.mkdir(metadataDir, { recursive: true });
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });

  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error(
      `Hook script not found at ${scriptPath}. Run "pnpm run compile" first.`
    );
  }

  let config: HooksConfig = { version: 1, hooks: {} };

  try {
    const raw = await fs.readFile(hooksPath, 'utf8');
    config = JSON.parse(raw) as HooksConfig;
    if (!config.hooks) {
      config.hooks = {};
    }
    if (config.version === undefined) {
      config.version = 1;
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }

  const entries = config.hooks!.beforeSubmitPrompt ?? [];
  const filtered = entries.filter(
    (entry) =>
      !entry.command?.includes(HOOK_MARKER) &&
      !entry.command?.includes(scriptPath)
  );

  filtered.push({
    command: `node "${scriptPath}"`,
    timeout: 3,
    matcher: 'UserPromptSubmit',
    env: {
      CURSOR_ACCOUNTS_METADATA_DIR: metadataDir,
    },
  });

  config.hooks!.beforeSubmitPrompt = filtered;

  await fs.mkdir(path.dirname(hooksPath), { recursive: true });
  await fs.writeFile(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  extensionLog.info(
    `[HookInstaller] Registered beforeSubmitPrompt hook at ${hooksPath}`
  );
}

export async function uninstallEfficiencyHook(
  extensionPath: string
): Promise<void> {
  const hooksPath = getHooksFilePath();
  const scriptPath = getHookScriptPath(extensionPath);

  try {
    const raw = await fs.readFile(hooksPath, 'utf8');
    const config = JSON.parse(raw) as HooksConfig;
    if (!config.hooks?.beforeSubmitPrompt) {
      return;
    }

    config.hooks.beforeSubmitPrompt = config.hooks.beforeSubmitPrompt.filter(
      (entry) =>
        !entry.command?.includes(HOOK_MARKER) &&
        !entry.command?.includes(scriptPath)
    );

    if (config.hooks.beforeSubmitPrompt.length === 0) {
      delete config.hooks.beforeSubmitPrompt;
    }

    await fs.writeFile(
      hooksPath,
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8'
    );
    extensionLog.info('[HookInstaller] Removed efficiency hook entry');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }
}
