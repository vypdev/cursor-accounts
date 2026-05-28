const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');
const outDir = path.join(__dirname, '..', 'webview-dist');

const buildOptions = {
  entryPoints: [path.join(__dirname, 'src', 'index.tsx')],
  bundle: true,
  outfile: path.join(outDir, 'bundle.js'),
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
  },
  sourcemap: true,
  minify: !isWatch,
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
  },
};

async function ensureOutDir() {
  await fs.promises.mkdir(outDir, { recursive: true });
}

async function copyCssBundle() {
  const candidates = [
    path.join(outDir, 'index.css'),
    path.join(outDir, 'bundle.css'),
    path.join(outDir, 'src', 'index.css'),
  ];

  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate);
      if (candidate !== path.join(outDir, 'bundle.css')) {
        await fs.promises.copyFile(candidate, path.join(outDir, 'bundle.css'));
      }
      return;
    } catch {
      // try next candidate
    }
  }

  const appCss = path.join(__dirname, 'src', 'App.css');
  await fs.promises.copyFile(appCss, path.join(outDir, 'bundle.css'));
}

async function build() {
  await ensureOutDir();
  await esbuild.build(buildOptions);
  await copyCssBundle();
  console.log('Webview build complete!');
}

async function watch() {
  await ensureOutDir();
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching webview for changes...');
}

if (isWatch) {
  watch().catch(() => process.exit(1));
} else {
  build().catch(() => process.exit(1));
}
