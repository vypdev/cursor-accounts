import { exec } from 'child_process';
import { promisify } from 'util';
import { pathsEqual } from '../utils/pathUtils';
import { ProfileManager } from './profileManager';
import { InstanceInfo, InstanceInfoMap } from './types';

const execAsync = promisify(exec);

const PROCESS_COMMAND_TIMEOUT_MS = 5000;

/** Raw Cursor process info from OS inspection. */
export interface CursorProcess {
  pid: number;
  userDataDir?: string;
  startTime?: number;
}

export class InstanceDetectorError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'InstanceDetectorError';
  }
}

/** Convert instance Map to JSON-safe Record for webview messaging. */
export function instanceMapToRecord(
  instances: Map<string, InstanceInfo>
): InstanceInfoMap {
  return Object.fromEntries(instances.entries());
}

/** Returns true if the command line belongs to a helper process. */
export function isHelperProcess(command: string): boolean {
  return command.includes('Helper') || command.includes('--type=');
}

/** Extract --user-data-dir from a process command line. */
export function extractUserDataDir(command: string): string | undefined {
  const match = command.match(
    /--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s"']+))/
  );
  if (!match) {
    return undefined;
  }

  const value = match[1] ?? match[2] ?? match[3];
  return value?.replace(/"/g, '');
}

/** Parse macOS `ps` output into Cursor processes. */
export function parseMacOSPsOutput(stdout: string): CursorProcess[] {
  const processes: CursorProcess[] = [];

  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) {
      continue;
    }

    try {
      const match = line.match(/^\s*(\d+)\s+(.+?)\s+(\/.*?)$/);
      if (!match) {
        console.warn('Failed to parse ps line:', line);
        continue;
      }

      const pid = parseInt(match[1], 10);
      if (isNaN(pid)) {
        console.warn('Invalid PID in ps line:', line);
        continue;
      }

      const command = match[3];

      if (isHelperProcess(command)) {
        continue;
      }

      processes.push({
        pid,
        userDataDir: extractUserDataDir(command),
      });
    } catch (lineError) {
      console.error('Error parsing ps line:', line, lineError);
    }
  }

  return processes;
}

/** Parse Linux `ps` output into Cursor processes. */
export function parseLinuxPsOutput(stdout: string): CursorProcess[] {
  const processes: CursorProcess[] = [];

  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) {
      continue;
    }

    try {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) {
        console.warn('Failed to parse ps line:', line);
        continue;
      }

      const pid = parseInt(match[1], 10);
      if (isNaN(pid)) {
        console.warn('Invalid PID in ps line:', line);
        continue;
      }

      const command = match[2];

      if (isHelperProcess(command)) {
        continue;
      }

      processes.push({
        pid,
        userDataDir: extractUserDataDir(command),
      });
    } catch (lineError) {
      console.error('Error parsing ps line:', line, lineError);
    }
  }

  return processes;
}

/** Parse Windows PowerShell JSON output into Cursor processes. */
export function parseWindowsPowerShellJson(stdout: string): CursorProcess[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  let processData: unknown;
  try {
    processData = JSON.parse(trimmed);
  } catch (jsonError) {
    console.error('Failed to parse PowerShell JSON output:', stdout);
    throw new Error('Invalid JSON from PowerShell');
  }

  if (processData === null || processData === undefined) {
    return [];
  }

  const processArray = Array.isArray(processData) ? processData : [processData];
  const processes: CursorProcess[] = [];

  for (const proc of processArray) {
    if (!proc || typeof proc !== 'object' || !('Id' in proc)) {
      continue;
    }

    try {
      const entry = proc as { Id: unknown; CommandLine?: string };
      const pid = parseInt(String(entry.Id), 10);
      if (isNaN(pid)) {
        continue;
      }

      const command = entry.CommandLine ?? '';

      if (isHelperProcess(command)) {
        continue;
      }

      processes.push({
        pid,
        userDataDir: extractUserDataDir(command),
      });
    } catch (procError) {
      console.error('Error processing PowerShell process entry:', proc, procError);
    }
  }

  return processes;
}

/** Parse Windows wmic output into Cursor processes. */
export function parseWindowsWmicOutput(stdout: string): CursorProcess[] {
  const processes: CursorProcess[] = [];

  for (const block of stdout.split('\n\n')) {
    if (!block.trim()) {
      continue;
    }

    try {
      const pidMatch = block.match(/ProcessId=(\d+)/);
      const commandMatch = block.match(/CommandLine=(.+)/);

      if (!pidMatch) {
        continue;
      }

      const pid = parseInt(pidMatch[1], 10);
      if (isNaN(pid)) {
        continue;
      }

      const command = commandMatch ? commandMatch[1] : '';

      if (isHelperProcess(command)) {
        continue;
      }

      processes.push({
        pid,
        userDataDir: extractUserDataDir(command),
      });
    } catch (blockError) {
      console.error('Error parsing wmic block:', block, blockError);
    }
  }

  return processes;
}

export class InstanceDetector {
  private pollTimer: NodeJS.Timeout | undefined;
  private lastDetection: Map<string, InstanceInfo> = new Map();
  private onDetectionChangeCallbacks: Array<
    (instances: Map<string, InstanceInfo>) => void
  > = [];

  constructor(
    private readonly profileManager: ProfileManager,
    private readonly processProvider?: () => Promise<CursorProcess[]>
  ) {}

  /** Register callback for detection updates (e.g. Accounts panel). */
  onDetectionChange(
    callback: (instances: Map<string, InstanceInfo>) => void
  ): void {
    this.onDetectionChangeCallbacks.push(callback);
  }

  /**
   * Detect all running Cursor instances and match to profiles.
   */
  async detectRunningInstances(): Promise<Map<string, InstanceInfo>> {
    try {
      const processes = await this.getCursorProcesses();
      const profiles = await this.profileManager.getProfiles();

      const instances = new Map<string, InstanceInfo>();

      for (const proc of processes) {
        const profile = profiles.find(
          (p) =>
            proc.userDataDir &&
            pathsEqual(proc.userDataDir, p.userDataDir)
        );

        if (profile) {
          instances.set(profile.id, {
            profileId: profile.id,
            pid: proc.pid,
            startTime: proc.startTime,
            userDataDir: proc.userDataDir ?? profile.userDataDir,
            detectedAt: Date.now(),
          });
        }
      }

      const changed = !mapsEqual(this.lastDetection, instances);
      this.lastDetection = instances;

      if (changed) {
        this.notifyDetectionChange(instances);
      }

      return instances;
    } catch (error) {
      throw new InstanceDetectorError(
        'Failed to detect running instances',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if a specific profile is currently running.
   */
  async isProfileRunning(profileId: string): Promise<boolean> {
    const instances = await this.detectRunningInstances();
    return instances.has(profileId);
  }

  /**
   * Get last detected instances (cached).
   */
  getLastDetection(): Map<string, InstanceInfo> {
    return new Map(this.lastDetection);
  }

  /**
   * Start automatic detection with polling.
   */
  startAutoDetection(intervalMs = 30000): void {
    this.stopAutoDetection();

    void this.detectRunningInstances().catch((error) => {
      console.error('Initial instance detection failed:', error);
    });

    this.pollTimer = setInterval(() => {
      void this.detectRunningInstances().catch((error) => {
        console.error('Instance detection poll failed:', error);
      });
    }, intervalMs);
  }

  /**
   * Stop automatic detection.
   */
  stopAutoDetection(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Get Cursor processes running on the system.
   * Platform-specific implementation.
   */
  private async getCursorProcesses(): Promise<CursorProcess[]> {
    if (this.processProvider) {
      return await this.processProvider();
    }

    switch (process.platform) {
      case 'darwin':
        return await this.getCursorProcessesMacOS();
      case 'win32':
        return await this.getCursorProcessesWindows();
      default:
        return await this.getCursorProcessesLinux();
    }
  }

  private async getCursorProcessesMacOS(): Promise<CursorProcess[]> {
    try {
      const { stdout } = await execAsync(
        'ps -eo pid,lstart,args | grep -i "[C]ursor" | grep -i "MacOS/Cursor"',
        { timeout: PROCESS_COMMAND_TIMEOUT_MS }
      );

      return parseMacOSPsOutput(stdout);
    } catch (error) {
      if (isExecNotFoundError(error)) {
        return [];
      }

      console.error('Failed to get Cursor processes on macOS:', error);
      throw new InstanceDetectorError(
        'Failed to detect running Cursor instances on macOS',
        error instanceof Error ? error : undefined
      );
    }
  }

  private async getCursorProcessesWindows(): Promise<CursorProcess[]> {
    try {
      return await this.getCursorProcessesWindowsPowerShell();
    } catch (psError) {
      console.warn('PowerShell detection failed, falling back to wmic:', psError);

      try {
        return await this.getCursorProcessesWindowsWmic();
      } catch (wmicError) {
        console.error('Both PowerShell and wmic detection failed');
        throw new InstanceDetectorError(
          'Failed to detect running Cursor instances on Windows',
          wmicError instanceof Error ? wmicError : undefined
        );
      }
    }
  }

  private async getCursorProcessesWindowsPowerShell(): Promise<CursorProcess[]> {
    try {
      const { stdout } = await execAsync(
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

  private async getCursorProcessesWindowsWmic(): Promise<CursorProcess[]> {
    try {
      const { stdout } = await execAsync(
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

  private async getCursorProcessesLinux(): Promise<CursorProcess[]> {
    try {
      const { stdout } = await execAsync(
        'ps -eo pid,args | grep -i "[c]ursor" | grep -v grep',
        { timeout: PROCESS_COMMAND_TIMEOUT_MS }
      );

      return parseLinuxPsOutput(stdout);
    } catch (error) {
      if (isExecNotFoundError(error)) {
        return [];
      }

      console.error('Failed to get Cursor processes on Linux:', error);
      throw new InstanceDetectorError(
        'Failed to detect running Cursor instances on Linux',
        error instanceof Error ? error : undefined
      );
    }
  }

  private notifyDetectionChange(
    instances: Map<string, InstanceInfo>
  ): void {
    for (const callback of this.onDetectionChangeCallbacks) {
      try {
        callback(new Map(instances));
      } catch (error) {
        console.error('Instance detection callback failed:', error);
      }
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

function mapsEqual(
  a: Map<string, InstanceInfo>,
  b: Map<string, InstanceInfo>
): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || other.pid !== value.pid) {
      return false;
    }
  }

  return true;
}
