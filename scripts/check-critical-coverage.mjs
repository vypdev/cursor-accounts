import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const lcovPath = path.join(root, 'coverage', 'lcov.info');

const floors = [
  { file: 'src/proxy/bodyCapture.ts', lines: 70, branches: 60 },
  {
    file: 'src/proxy/api/middleware/localhostValidator.ts',
    lines: 80,
    branches: 75,
  },
  { file: 'src/auth/tokenRefresh.ts', lines: 65, branches: 55 },
  { file: 'src/proxy/proxyLogCleanup.ts', lines: 90, branches: 75 },
];

export function checkCriticalCoverage(content) {
  const records = new Map();
  for (const record of content.split('end_of_record')) {
    const file = record.match(/^SF:(.+)$/m)?.[1];
    if (!file) {
      continue;
    }
    records.set(file.replaceAll('\\', '/'), {
      lines: readMetric(record, 'LF', 'LH'),
      branches: readMetric(record, 'BRF', 'BRH'),
    });
  }

  const failures = [];
  for (const floor of floors) {
    const metric = records.get(floor.file);
    if (!metric) {
      failures.push(`${floor.file}: coverage record is missing`);
      continue;
    }
    if (metric.lines < floor.lines) {
      failures.push(
        `${floor.file}: lines ${metric.lines.toFixed(2)}% < ${floor.lines}%`
      );
    }
    if (metric.branches < floor.branches) {
      failures.push(
        `${floor.file}: branches ${metric.branches.toFixed(2)}% < ${floor.branches}%`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Critical coverage floors failed:\n- ${failures.join('\n- ')}`);
  }

  return floors.map((floor) => ({
    ...floor,
    ...records.get(floor.file),
  }));
}

function readMetric(record, totalKey, hitKey) {
  const total = Number(record.match(new RegExp(`^${totalKey}:(\\d+)$`, 'm'))?.[1] ?? 0);
  const hit = Number(record.match(new RegExp(`^${hitKey}:(\\d+)$`, 'm'))?.[1] ?? 0);
  return total === 0 ? 100 : (hit / total) * 100;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!fs.existsSync(lcovPath)) {
    throw new Error(`Coverage report not found: ${lcovPath}`);
  }
  const results = checkCriticalCoverage(fs.readFileSync(lcovPath, 'utf8'));
  for (const result of results) {
    console.log(
      `${result.file}: ${result.lines.toFixed(2)}% lines, ${result.branches.toFixed(2)}% branches`
    );
  }
}
