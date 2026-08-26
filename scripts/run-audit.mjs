import { spawnSync } from 'node:child_process';

const checks = [
  {
    label: 'Node.js and pnpm toolchain contract',
    command: 'pnpm',
    args: ['run', 'verify:toolchain'],
  },
  {
    label: 'production supply-chain evidence',
    command: 'pnpm',
    args: ['run', 'audit:supply-chain', '--', '--output', '.tmp/supply-chain-report.json'],
  },
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
    label: 'native prebuild helper tests',
    command: 'pnpm',
    args: ['run', 'test:native-prebuild'],
  },
  {
    label: 'build target argument tests',
    command: 'pnpm',
    args: ['run', 'test:build-targets'],
  },
  {
    label: 'VSIX verifier contract tests',
    command: 'pnpm',
    args: ['run', 'test:vsix-verifier'],
  },
  {
    label: 'protobuf JSONL verifier tests',
    command: 'pnpm',
    args: ['run', 'test:verify-proto-jsonl'],
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
    label: 'webview tests and coverage floors',
    command: 'pnpm',
    args: ['--dir', 'webview', 'run', 'test:coverage'],
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
