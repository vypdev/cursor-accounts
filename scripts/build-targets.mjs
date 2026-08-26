export const ALL_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
  'win32-arm64',
];

export const PLATFORM_SDK_PACKAGE = {
  'darwin-arm64': '@cursor/sdk-darwin-arm64',
  'darwin-x64': '@cursor/sdk-darwin-x64',
  'linux-x64': '@cursor/sdk-linux-x64',
  'linux-arm64': '@cursor/sdk-linux-arm64',
  'win32-x64': '@cursor/sdk-win32-x64',
  'win32-arm64': '@cursor/sdk-win32-x64',
};

/** Resolve build flags into an explicit, validated target list. */
export function parseBuildArgs(
  argv,
  runtime = { platform: process.platform, arch: process.arch }
) {
  const args = {
    all: false,
    current: false,
    targets: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--all') {
      args.all = true;
      continue;
    }

    if (arg === '--current') {
      args.current = true;
      continue;
    }

    if (arg === '--target') {
      const target = argv[index + 1];
      if (!target || !ALL_TARGETS.includes(target)) {
        throw new Error(
          `Invalid target "${target ?? ''}". Expected one of: ${ALL_TARGETS.join(', ')}`
        );
      }
      args.targets.push(target);
      index += 1;
      continue;
    }

    if (ALL_TARGETS.includes(arg)) {
      args.targets.push(arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.all) {
    args.targets = [...ALL_TARGETS];
  } else if (args.current) {
    args.targets = [`${runtime.platform}-${runtime.arch}`];
  } else if (args.targets.length === 0) {
    args.targets = [`${runtime.platform}-${runtime.arch}`];
  }

  return args;
}
