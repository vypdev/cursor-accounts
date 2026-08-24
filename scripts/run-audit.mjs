import { spawnSync } from 'node:child_process';

const checks = [
  { label: 'lint and type checks', command: 'pnpm', args: ['run', 'lint'] },
  {
    label: 'architecture rules',
    command: 'pnpm',
    args: ['run', 'check:architecture'],
  },
  {
    label: 'architecture fixtures',
    command: 'pnpm',
    args: ['run', 'test:architecture'],
  },
  {
    label: 'webview type synchronization',
    command: 'pnpm',
    args: ['run', 'test:types-sync'],
  },
  {
    label: 'localization parity',
    command: 'pnpm',
    args: ['run', 'validate:l10n'],
  },
  {
    label: 'documentation links',
    command: 'pnpm',
    args: ['run', 'check:docs'],
  },
  {
    label: 'extension tests and coverage floors',
    command: 'pnpm',
    args: ['run', 'test:coverage'],
  },
  {
    label: 'webview tests',
    command: 'pnpm',
    args: ['--dir', 'webview', 'test'],
  },
  {
    label: 'current VSIX contents',
    command: 'node',
    args: ['scripts/verify-vsix.mjs'],
  },
];

for (const check of checks) {
  console.log(`\n==> ${check.label}`);
  const result = spawnSync(check.command, check.args, {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\nAudit completed successfully.');
