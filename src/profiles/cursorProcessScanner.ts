import { exec } from 'child_process';
import { promisify } from 'util';
import * as extensionLog from '../logging/extensionLog';
import {
  type CursorProcess,
  parseLinuxPsOutput,
  parseMacOSPsOutput,
  parseWindowsPowerShellJson,
  parseWindowsWmicOutput,
} from './instanceProcessParser';

const execAsync = promisify(exec);
const PROCESS_COMMAND_TIMEOUT_MS = 5000;

export type ProcessCommandExecutor = (
  command: string,
  options: { timeout: number }
) => Promise<{ stdout: string }>;

const defaultProcessCommandExecutor: ProcessCommandExecutor = async (
  command,
  options
) => {
  const { stdout } = await execAsync(command, options);
  return { stdout };
};

/** Supplies process inspection results for deterministic tests or alternate hosts. */
export type CursorProcessProvider = () => Promise<CursorProcess[]>;

export interface CursorProcessScannerOptions {
  platform?: NodeJS.Platform;
  execute?: ProcessCommandExecutor;
}

/** Reads main Cursor processes from the host operating system. */
export class CursorProcessScanner {
  private readonly platform: NodeJS.Platform;
  private readonly execute: ProcessCommandExecutor;

  constructor(
    private readonly processProvider?: CursorProcessProvider,
    options: CursorProcessScannerOptions = {}
  ) {
    this.platform = options.platform ?? process.platform;
    this.execute = options.execute ?? defaultProcessCommandExecutor;
  }

  async scan(): Promise<CursorProcess[]> {
    if (this.processProvider) {
      return await this.processProvider();
    }

    switch (this.platform) {
      case 'darwin':
        return await this.scanMacOS();
      case 'win32':
        return await this.scanWindows();
      default:
        return await this.scanLinux();
    }
  }

  private async scanMacOS(): Promise<CursorProcess[]> {
    try {
      const { stdout } = await this.execute(
        'ps -eo pid,lstart,args | grep -i "[C]ursor" | grep -i "MacOS/Cursor"',
        { timeout: PROCESS_COMMAND_TIMEOUT_MS }
      );

      return parseMacOSPsOutput(stdout);
    } catch (error) {
      if (isExecNotFoundError(error)) {
        return [];
      }

      extensionLog.error(
        `[CursorProcessScanner] Failed to get Cursor processes on macOS: ${extensionLog.formatError(error)}`
      );
      throw error;
    }
  }

  private async scanWindows(): Promise<CursorProcess[]> {
    try {
      return await this.scanWindowsPowerShell();
    } catch (psError) {
      extensionLog.warn(
        `[CursorProcessScanner] PowerShell detection failed, falling back to wmic: ${extensionLog.formatError(psError)}`
      );

      try {
        return await this.scanWindowsWmic();
      } catch (wmicError) {
        extensionLog.error(
          `[CursorProcessScanner] Both PowerShell and wmic detection failed: ${extensionLog.formatError(wmicError)}`
        );
        throw wmicError;
      }
    }
  }

  private async scanWindowsPowerShell(): Promise<CursorProcess[]> {
    try {
      const { stdout } = await this.execute(
        'powershell -Command "Get-Process | Where-Object {$_.ProcessName -eq \'Cursor\'} | ' +
          'Select-Object Id,CommandLine | ConvertTo-Json"',
        { timeout: PROCESS_COMMAND_TIMEOUT_MS }
      );

      return parseWindowsPowerShellJson(stdout);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('Cannot find a process') ||
          isExecNotFoundError(error))
      ) {
        return [];
      }
      throw error;
    }
  }

  private async scanWindowsWmic(): Promise<CursorProcess[]> {
    try {
      const { stdout } = await this.execute(
        'wmic process where "name=\'Cursor.exe\'" get ProcessId,CommandLine /format:list',
        { timeout: PROCESS_COMMAND_TIMEOUT_MS }
      );

      return parseWindowsWmicOutput(stdout);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('No Instance') || isExecNotFoundError(error))
      ) {
        return [];
      }
      throw error;
    }
  }

  private async scanLinux(): Promise<CursorProcess[]> {
    try {
      const { stdout } = await this.execute(
        'ps -eo pid,args | grep -i "[c]ursor" | grep -v grep',
        { timeout: PROCESS_COMMAND_TIMEOUT_MS }
      );

      return parseLinuxPsOutput(stdout);
    } catch (error) {
      if (isExecNotFoundError(error)) {
        return [];
      }

      extensionLog.error(
        `[CursorProcessScanner] Failed to get Cursor processes on Linux: ${extensionLog.formatError(error)}`
      );
      throw error;
    }
  }
}

function isExecNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 1 || error.code === 'ENOENT')
  );
}
