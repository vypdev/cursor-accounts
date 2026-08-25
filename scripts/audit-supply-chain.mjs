#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const isolatedPnpmVersion = '11.19.0';

function parseArguments(argv) {
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      continue;
    }
    if (argument === '--output') {
      output = argv[index + 1];
      if (!output) {
        throw new Error('--output requires a file path');
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { output: output ? path.resolve(repositoryRoot, output) : undefined };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  return result;
}

function parseJsonOutput(label, output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} did not return valid JSON:\n${output.slice(0, 2000)}`);
  }
}

function verifyProjectToolchain() {
  const result = run(process.execPath, ['scripts/verify-toolchain.mjs']);
  if (result.status !== 0) {
    throw new Error('The project toolchain contract failed.');
  }
}

function runProductionAdvisoryAudit() {
  const result = run('pnpm', ['audit', '--prod', '--json']);
  const report = parseJsonOutput('pnpm audit', result.stdout);
  const vulnerabilities = report.metadata?.vulnerabilities ?? {};
  const total = Object.values(vulnerabilities).reduce(
    (sum, count) => sum + (Number.isFinite(count) ? count : 0),
    0
  );

  if (result.status !== 0 && total === 0) {
    throw new Error(`pnpm audit failed without a vulnerability report:\n${result.stderr}`);
  }

  return {
    status: total === 0 ? 'passed' : 'failed',
    vulnerabilities,
    total,
  };
}

function runLicenseInventory() {
  const result = run('pnpm', ['licenses', 'list', '--prod', '--json']);
  if (result.status !== 0) {
    throw new Error(`pnpm licenses failed:\n${result.stderr}`);
  }

  const grouped = parseJsonOutput('pnpm licenses', result.stdout);
  const records = Object.values(grouped).flat();
  const unknownPackages = records
    .filter((record) => record.license === 'Unknown')
    .map((record) => `${record.name}@${record.versions?.join(',') ?? 'unknown'}`)
    .sort();

  return {
    packageRecords: records.length,
    groups: Object.keys(grouped).sort(),
    unknownPackages,
    status: unknownPackages.length === 0 ? 'passed' : 'review_required',
  };
}

function installIsolatedPnpm() {
  const toolDirectory = mkdtempSync(path.join(tmpdir(), 'cursor-accounts-pnpm-audit-'));
  try {
    const npmResult = run('npm', [
      '--prefix',
      toolDirectory,
      'install',
      '--no-save',
      '--ignore-scripts',
      `pnpm@${isolatedPnpmVersion}`,
    ]);
    if (npmResult.status !== 0) {
      throw new Error(`Unable to install isolated pnpm ${isolatedPnpmVersion}:\n${npmResult.stderr}`);
    }

    return {
      toolDirectory,
      executable: path.join(toolDirectory, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    };
  } catch (error) {
    rmSync(toolDirectory, { recursive: true, force: true });
    throw error;
  }
}

function runSignatureAudit(pnpm) {
  const result = run(process.execPath, [
    pnpm,
    'with',
    'current',
    'audit',
    'signatures',
    '--prod',
    '--json',
  ]);
  if (result.status !== 0) {
    throw new Error(`Signature audit failed:\n${result.stderr}`);
  }

  const report = parseJsonOutput('pnpm audit signatures', result.stdout);
  const passed = report.invalid?.length === 0 && report.missing?.length === 0;
  return {
    auditor: `pnpm@${isolatedPnpmVersion}`,
    audited: report.audited ?? 0,
    verified: report.verified ?? 0,
    invalid: report.invalid ?? [],
    missing: report.missing ?? [],
    status: passed ? 'passed' : 'failed',
  };
}

function runSbom(pnpm, temporaryDirectory) {
  const sbomPath = path.join(temporaryDirectory, 'production-sbom.cdx.json');
  const result = run(process.execPath, [
    pnpm,
    'with',
    'current',
    'sbom',
    '--sbom-format',
    'cyclonedx',
    '--sbom-spec-version',
    '1.5',
    '--prod',
    '--lockfile-only',
    '--out',
    sbomPath,
  ]);
  if (result.status !== 0) {
    throw new Error(`SBOM generation failed:\n${result.stderr}`);
  }

  const report = JSON.parse(readFileSync(sbomPath, 'utf8'));
  const valid = report.bomFormat === 'CycloneDX'
    && report.specVersion === '1.5'
    && Array.isArray(report.components);
  if (!valid) {
    throw new Error('Generated SBOM does not match the expected CycloneDX 1.5 shape.');
  }

  return {
    format: report.bomFormat,
    specVersion: report.specVersion,
    components: report.components.length,
    metadataComponent: report.metadata?.component?.name,
    status: 'passed',
  };
}

function main() {
  const { output } = parseArguments(process.argv.slice(2));
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  verifyProjectToolchain();

  const advisory = runProductionAdvisoryAudit();
  const licenses = runLicenseInventory();
  const isolatedPnpm = installIsolatedPnpm();
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'cursor-accounts-supply-chain-'));

  try {
    const signatures = runSignatureAudit(isolatedPnpm.executable);
    const sbom = runSbom(isolatedPnpm.executable, temporaryDirectory);
    const report = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      projectPackageManager: packageJson.packageManager,
      advisory,
      licenses,
      signatures,
      sbom,
    };

    if (output) {
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Supply-chain report written to ${output}`);
    } else {
      console.log(JSON.stringify(report, null, 2));
    }

    if (advisory.status === 'failed' || signatures.status === 'failed') {
      process.exitCode = 1;
    }
  } finally {
    rmSync(isolatedPnpm.toolDirectory, { recursive: true, force: true });
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main();
