import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const docsRoot = path.join(repositoryRoot, 'docs');
const markdownFiles = [];

function collectMarkdownFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      markdownFiles.push(entryPath);
    }
  }
}

function headingSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function collectHeadingSlugs(markdown) {
  const slugs = new Set();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    slugs.add(headingSlug(match[1] ?? ''));
  }
  return slugs;
}

function normalizeAnchor(anchor) {
  return anchor.toLowerCase().replace(/-+/g, '-');
}

function isExternalHref(href) {
  return /^(?:https?:|mailto:|data:|file:)/i.test(href) || href.startsWith('#');
}

collectMarkdownFiles(docsRoot);

const failures = [];
for (const markdownFile of markdownFiles) {
  const source = fs.readFileSync(markdownFile, 'utf8');
  for (const match of source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) {
    const rawHref = (match[1] ?? '').trim().replace(/^<|>$/g, '');
    if (!rawHref || isExternalHref(rawHref)) {
      continue;
    }

    const [rawPath, rawAnchor] = rawHref.split('#', 2);
    const targetPath = rawPath
      ? path.resolve(path.dirname(markdownFile), decodeURIComponent(rawPath))
      : markdownFile;
    if (!fs.existsSync(targetPath)) {
      failures.push(`${path.relative(repositoryRoot, markdownFile)} -> ${rawHref}`);
      continue;
    }

    if (rawAnchor && fs.statSync(targetPath).isFile()) {
      const targetSource = fs.readFileSync(targetPath, 'utf8');
      const headingSlugs = collectHeadingSlugs(targetSource);
      if (!headingSlugs.has(rawAnchor.toLowerCase()) &&
          !headingSlugs.has(normalizeAnchor(rawAnchor))) {
        failures.push(
          `${path.relative(repositoryRoot, markdownFile)} -> ${rawHref} (missing anchor)`
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Documentation link check failed: ${failures.length} issue(s)`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Documentation link check passed: ${markdownFiles.length} Markdown file(s).`);
