import { spawn } from 'child_process';

export interface CertificateProcessRunner {
  run(
    command: string,
    args: string[],
    timeoutMs?: number
  ): Promise<{ code: number | null; stderr: string }>;
}

export const DEFAULT_CERTIFICATE_PROCESS_TIMEOUT_MS = 120_000;
export const CERTIFICATE_PROCESS_KILL_GRACE_MS = 1_000;

export async function runCertificateProcess(
  command: string,
  args: string[],
  timeoutMs = DEFAULT_CERTIFICATE_PROCESS_TIMEOUT_MS
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const effectiveTimeoutMs = Math.max(1, timeoutMs);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, CERTIFICATE_PROCESS_KILL_GRACE_MS);
    }, effectiveTimeoutMs);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (timedOut) {
        reject(
          new Error(
            `Certificate process timed out after ${effectiveTimeoutMs}ms`
          )
        );
        return;
      }
      resolve({ code, stderr: stderr.trim() });
    });
  });
}

export const defaultCertificateProcessRunner: CertificateProcessRunner = {
  run: runCertificateProcess,
};
