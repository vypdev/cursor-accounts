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
    sourceRoots: [path.join(root, 'src')],
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
}

await checkFixture('valid', { boundaryViolation: false, cycle: false });
await checkFixture('invalid-boundary', { boundaryViolation: true, cycle: false });
await checkFixture('invalid-cycle', { boundaryViolation: false, cycle: true });
await checkFixture('invalid-unresolved', { boundaryViolation: true, cycle: false });
console.log('Architecture checker fixtures passed.');
