#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export {
  createExtractionPlan,
  defaultCursorAppPath,
  extractCursorProtos,
  main,
  readCursorVersion,
  resolveExtensionHostPath,
} from './cursor-proto-extraction.mjs';

import { main } from './cursor-proto-extraction.mjs';

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href
) {
  main();
}
