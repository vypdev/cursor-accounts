#!/usr/bin/env node
/**
 * Diagnose whether MITM logs contain interactive chat/agent traffic.
 *
 * Usage:
 *   node scripts/scan-proxy-interactive.mjs [log-file-or-dir]
 *   pnpm run scan:proxy-interactive
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  INTERACTIVE_RPC_MARKERS,
  isInteractiveRpcPath,
  parseConnectRpcPath,
} from './lib/proxy-rpc.mjs';

const DEFAULT_LOG_DIR = path.join(
  process.env.HOME ?? '',
  '.cursor-accounts',
  'proxy',
  'logs'
);

const CURSOR_API_HOST_RE = /^api[0-9]*\.cursor\.sh$|^agent[^.]*\.api[0-9]*\.cursor\.sh$/;

function resolveLogFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return [target];
  }
  return fs
    .readdirSync(target)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(target, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function main() {
  const target = path.resolve(process.argv[2] ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(1);
  }

  const files = resolveLogFiles(target);
  if (files.length === 0) {
    console.error(`No .jsonl logs in ${target}`);
    process.exit(1);
  }

  const hosts = new Map();
  const paths = new Map();
  let requests = 0;
  let responses = 0;
  let certErrors = 0;
  let hangUps = 0;
  let connectRpc = 0;

  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.direction === 'error') {
        const msg = String(entry.errorMessage ?? '');
        if (msg.includes('CERTIFICA')) {
          certErrors += 1;
        }
        if (msg.includes('hang up')) {
          hangUps += 1;
        }
        continue;
      }

      if (entry.direction === 'request') {
        requests += 1;
      } else if (entry.direction === 'response') {
        responses += 1;
      } else {
        continue;
      }

      const host = String(entry.host ?? '');
      if (host) {
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
      }

      const ct = String(entry.headers?.['content-type'] ?? '').toLowerCase();
      if (ct.includes('application/connect')) {
        connectRpc += 1;
      }

      const rpcPath = parseConnectRpcPath(entry.url);
      if (rpcPath) {
        paths.set(rpcPath, (paths.get(rpcPath) ?? 0) + 1);
      }
    }
  }

  const pathList = [...paths.entries()].sort((a, b) => b[1] - a[1]);
  const interactivePaths = pathList.filter(([p]) => isInteractiveRpcPath(p));
  const foundMarkers = INTERACTIVE_RPC_MARKERS.filter((marker) =>
    pathList.some(([p]) => marker.test(p))
  );

  const api2 = hosts.get('api2.cursor.sh') ?? 0;
  const api5Hosts = [...hosts.keys()].filter(
    (h) => CURSOR_API_HOST_RE.test(h) && h.includes('api5')
  );
  const api5Total = api5Hosts.reduce((sum, h) => sum + (hosts.get(h) ?? 0), 0);

  const runPollOnApi2 = pathList.some(
    ([p, n]) => p.includes('AgentService/RunPoll') && n > 0
  );

  console.log(`Log files: ${files.length} (newest: ${path.basename(files[0])})`);
  console.log(`Entries: ${requests} requests, ${responses} responses`);
  console.log(`Connect RPC lines: ${connectRpc}`);
  console.log(`TLS/proxy errors: ${certErrors} certificate rejections, ${hangUps} socket hang ups`);

  console.log('\n## Cursor API hosts');
  for (const [h, n] of [...hosts.entries()].sort((a, b) => b[1] - a[1])) {
    if (h.includes('cursor') || CURSOR_API_HOST_RE.test(h)) {
      console.log(`  ${n}\t${h}`);
    }
  }

  console.log('\n## Connect RPC paths (top 25)');
  for (const [p, n] of pathList.slice(0, 25)) {
    const tag = isInteractiveRpcPath(p) ? ' [interactive]' : '';
    console.log(`  ${n}\t${p}${tag}`);
  }

  console.log('\n## Interactive traffic check');
  console.log(
    `  api2.cursor.sh: ${api2} lines | api5* hosts: ${api5Total} lines (${api5Hosts.join(', ') || 'none'})`
  );
  if (foundMarkers.length) {
    for (const marker of foundMarkers) {
      const hits = pathList.filter(([p]) => marker.test(p));
      console.log(`  ✓ ${marker.label}: ${hits.map(([p, n]) => `${p} (${n})`).join(', ')}`);
    }
  } else {
    console.log('  ✗ No interactive chat/agent RPCs detected');
  }

  const hasMetricsOnly =
    pathList.some(([p]) => p.includes('ReportAgentSnapshot')) &&
    interactivePaths.length === 0;

  if (hasMetricsOnly) {
    console.log(
      '\n⚠ Only ReportAgentSnapshot — no RunPoll/BidiAppend/Stream* yet. Send an Agent message while logging.'
    );
  }

  if (api2 > 0 && api5Total === 0 && !runPollOnApi2 && interactivePaths.length === 0) {
    console.log(
      '\n⚠ api2 present but no interactive RPCs — enable HTTP/1, relaunch profile, chat again.'
    );
  }

  if (api5Total === 0 && runPollOnApi2) {
    console.log(
      '\n✓ Agent chat on api2 via HTTP/1 (RunPoll/Bidi) — expected when HTTP/2 is disabled.'
    );
  }

  if (certErrors > 50) {
    console.log(
      `\n⚠ Certificate rejections: ${certErrors} (older sessions or non-Cursor clients). If Network Diagnostics is green, recent Agent traffic is likely fine.`
    );
  }

  if (interactivePaths.length === 0) {
    process.exitCode = 1;
  }
}

main();
