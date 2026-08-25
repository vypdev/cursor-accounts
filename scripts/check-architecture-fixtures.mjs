import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runArchitectureCheck } from './check-architecture.mjs';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturesDirectory = path.join(scriptsDirectory, 'fixtures', 'architecture');

async function checkFixture(name, expected) {
  const root = path.join(fixturesDirectory, name);
  const result = await runArchitectureCheck({
    root,
    sourceRoots: expected.sourceRoots ?? [path.join(root, 'src')],
  });

  assert.equal(
    result.violations.length > 0,
    expected.boundaryViolation,
    `${name}: unexpected boundary result`
  );
  assert.equal(
    result.cycles.length > 0,
    expected.cycle,
    `${name}: unexpected cycle result`
  );
  if (expected.rule) {
    assert.ok(
      result.violations.some((violation) => violation.rule === expected.rule),
      `${name}: expected rule ${expected.rule}`
    );
  }
}

await checkFixture('valid', { boundaryViolation: false, cycle: false });
await checkFixture('invalid-boundary', {
  boundaryViolation: true,
  cycle: false,
  rule: 'domain-depends-outward',
});
await checkFixture('invalid-cycle', { boundaryViolation: false, cycle: true });
await checkFixture('invalid-unresolved', {
  boundaryViolation: true,
  cycle: false,
  rule: 'unresolved-relative-import',
});
await checkFixture('invalid-application-boundary', {
  boundaryViolation: true,
  cycle: false,
  rule: 'application-depends-on-infrastructure',
});
await checkFixture('invalid-external', {
  boundaryViolation: true,
  cycle: false,
  rule: 'domain-external-dependency',
});
await checkFixture('valid-workspace-package', {
  boundaryViolation: false,
  cycle: false,
  sourceRoots: [
    path.join(fixturesDirectory, 'valid-workspace-package', 'src'),
    path.join(fixturesDirectory, 'valid-workspace-package', 'packages', 'contracts', 'src'),
  ],
});
console.log('Architecture checker fixtures passed.');
