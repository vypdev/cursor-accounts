import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUT_PACKAGES } from './lib/cursor-proto-config.mjs';
import { extractDescriptors } from './lib/cursor-proto-descriptors.mjs';
import { generateProto } from './lib/cursor-proto-renderer.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const EXTENSION_HOST_SEGMENTS = [
  'Contents',
  'Resources',
  'app',
  'out',
  'vs',
  'workbench',
  'api',
  'node',
  'extensionHostProcess.js',
];

/**
 * @param {NodeJS.Platform} platform
 * @param {NodeJS.ProcessEnv} environment
 */
export function defaultCursorAppPath(platform = process.platform, environment = process.env) {
  if (platform === 'darwin') {
    return '/Applications/Cursor.app';
  }
  if (platform === 'win32') {
    return path.win32.join(
      environment.LOCALAPPDATA ?? '',
      'Programs',
      'Cursor',
      'Cursor.exe'
    );
  }
  return '/usr/share/cursor';
}

/**
 * @param {string} cursorAppPath
 * @param {NodeJS.Platform} platform
 */
export function resolveExtensionHostPath(cursorAppPath, platform = process.platform) {
  if (platform === 'win32') {
    const executable = cursorAppPath.endsWith('.exe')
      ? cursorAppPath
      : `${cursorAppPath}.exe`;
    return path.win32.join(
      path.win32.dirname(executable),
      'resources',
      'app',
      ...EXTENSION_HOST_SEGMENTS.slice(3)
    );
  }
  return path.join(cursorAppPath, ...EXTENSION_HOST_SEGMENTS);
}

/**
 * @param {string} cursorAppPath
 * @param {{ platform?: NodeJS.Platform, runCommand?: typeof execFileSync }} options
 */
export function readCursorVersion(
  cursorAppPath,
  { platform = process.platform, runCommand = execFileSync } = {}
) {
  if (platform !== 'darwin') {
    return 'unknown';
  }

  const plist = path.join(cursorAppPath, 'Contents', 'Info.plist');
  try {
    return runCommand('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * @param {{ repoRoot: string, hostPath: string, descriptors: ReturnType<typeof extractDescriptors>, cursorVersion: string, extractedAt: string }} options
 */
export function createExtractionPlan({
  repoRoot,
  hostPath,
  descriptors,
  cursorVersion,
  extractedAt,
}) {
  const files = OUTPUT_PACKAGES.map((pkg) => {
    const [namespace, version] = pkg.packageId.split('.');
    return {
      path: path.join(repoRoot, 'proto', namespace, version, pkg.fileName),
      content: generateProto(descriptors, pkg),
    };
  });
  files.push({
    path: path.join(repoRoot, 'proto', 'aiserver', 'v1', 'cursor-version.txt'),
    content: `${cursorVersion}\nextractedAt=${extractedAt}\nsource=${hostPath}\n`,
  });
  return files;
}

/**
 * Extract and write the current local Cursor descriptors.
 *
 * @param {{ cursorAppPath?: string, repoRoot?: string, platform?: NodeJS.Platform, fileSystem?: typeof fs, runCommand?: typeof execFileSync, now?: () => string, log?: (message: string) => void }} options
 */
export function extractCursorProtos({
  cursorAppPath,
  repoRoot = REPO_ROOT,
  platform = process.platform,
  fileSystem = fs,
  runCommand = execFileSync,
  now = () => new Date().toISOString(),
  log = (message) => console.error(message),
} = {}) {
  const resolvedCursorAppPath = path.resolve(
    cursorAppPath ?? defaultCursorAppPath(platform)
  );
  const hostPath = resolveExtensionHostPath(resolvedCursorAppPath, platform);
  if (!fileSystem.existsSync(hostPath)) {
    throw new Error(
      `extensionHostProcess.js not found:\n  ${hostPath}\nPass Cursor.app path: node scripts/extract-cursor-protos.mjs /Applications/Cursor.app`
    );
  }

  log(`Reading ${hostPath}`);
  const bundle = fileSystem.readFileSync(hostPath, 'utf8');
  const descriptors = extractDescriptors(bundle);
  log(
    `Parsed ${descriptors.symToType.size} symbols, ${descriptors.messageFieldsBlob.size} messages, ${descriptors.enumValues.size} enums, ${descriptors.services.size} services`
  );

  const plan = createExtractionPlan({
    repoRoot,
    hostPath,
    descriptors,
    cursorVersion: readCursorVersion(resolvedCursorAppPath, {
      platform,
      runCommand,
    }),
    extractedAt: now(),
  });

  for (const file of plan) {
    fileSystem.mkdirSync(path.dirname(file.path), { recursive: true });
    fileSystem.writeFileSync(file.path, file.content, 'utf8');
    log(`Wrote ${file.path}`);
  }
  return { hostPath, descriptors, files: plan.map(({ path: filePath }) => filePath) };
}

export function main() {
  const cursorAppPath = path.resolve(
    process.argv[2] ?? process.env.CURSOR_APP ?? defaultCursorAppPath()
  );
  try {
    extractCursorProtos({ cursorAppPath });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

