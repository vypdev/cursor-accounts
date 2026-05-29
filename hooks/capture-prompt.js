#!/usr/bin/env node
/**
 * Cursor beforeSubmitPrompt hook — captures prompt metadata for efficiency analysis.
 * Always returns continue: true (non-blocking).
 */
const fs = require('fs');
const path = require('path');

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const output = { continue: true };

  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      process.stdout.write(JSON.stringify(output));
      return;
    }

    const data = JSON.parse(raw);
    const metadataDir = process.env.CURSOR_ACCOUNTS_METADATA_DIR;

    if (!metadataDir) {
      process.stderr.write(
        'capture-prompt: CURSOR_ACCOUNTS_METADATA_DIR not set\n'
      );
      process.stdout.write(JSON.stringify(output));
      return;
    }

    const metadata = {
      timestamp: Date.now(),
      prompt: typeof data.prompt === 'string' ? data.prompt : '',
      model: typeof data.model === 'string' ? data.model : 'unknown',
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      conversationId:
        typeof data.conversation_id === 'string' ? data.conversation_id : '',
      workspaceRoots: Array.isArray(data.workspace_roots)
        ? data.workspace_roots
        : [],
    };

    if (!metadata.prompt.trim()) {
      process.stdout.write(JSON.stringify(output));
      return;
    }

    fs.mkdirSync(metadataDir, { recursive: true });
    const filename = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.json`;
    const filePath = path.join(metadataDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(metadata), 'utf8');
  } catch (err) {
    process.stderr.write(
      `capture-prompt error: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(
    `capture-prompt fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.stdout.write(JSON.stringify({ continue: true }));
});
