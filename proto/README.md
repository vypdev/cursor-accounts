# Cursor protobuf schemas (extracted)

Reverse-engineered from the **local Cursor IDE** bundle for MITM proxy decode (Connect-RPC / `application/connect+proto`).

## Files

| File | Package |
|------|---------|
| `aiserver/v1/aiserver.proto` | `aiserver.v1` — dashboard, usage, chat, cpp, … |
| `agent/v1/agent.proto` | `agent.v1` — agent/tool messages referenced by aiserver |
| `aiserver/v1/cursor-version.txt` | Cursor version used for extraction |

## Regenerate

```bash
pnpm run extract:protos
```

Requires Cursor installed (default macOS path: `/Applications/Cursor.app`).

## Test (load schema + decode proxy traffic)

```bash
pnpm run test:proto
```

Uses `protobufjs` to:

1. Load and resolve both `.proto` files
2. Decode a binary `GetUsageLimitStatusAndActiveGrants` response from proxy logs
3. Print JSON `GetCurrentPeriodUsage` responses when captured as Connect JSON

## Verify against all proxy JSONL logs

```bash
pnpm run verify:proto-jsonl
# optional: node scripts/verify-proto-jsonl.mjs ~/.cursor-accounts/proxy/logs
```

Walks every `aiserver.v1.*` request/response in JSONL files and checks:

- **JSON Connect** — response keys exist in the matching `*Request`/`*Response` message
- **`application/proto`** — decode with `protobufjs` (supports `bodyBase64`, decompressed bodies, and legacy UTF-8 logs)

## Analyze traffic (decode + insights)

```bash
pnpm run analyze:proxy-traffic
```

Decodes JSONL entries and prints billing/token insights where available.

## MITM integration

The proxy (`src/proxy/`) now:

- Logs binary bodies as **Base64** inline up to **Max Body Log MB**, or full raw bytes in `logs/bodies/*.bin` (`bodyFile`)
- **Decompresses** gzip/brotli before logging when possible
- Decodes Connect/protobuf via `protoRegistry` + `proxyDecode` when tailing logs
- Surfaces **billing / token / context** hints in the Output channel

## Source bundle

`Cursor.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js`

## Notes

- Re-run `extract:protos` after Cursor upgrades.
- Nested types use `_` (e.g. `GetCurrentPeriodUsageResponse_PlanUsage`).
- Cross-package fields use qualified names (e.g. `agent.v1.ModelDetails`).
- RPC methods with unresolved minified types are commented out in the `.proto`.
- Not an official Cursor API — research/debug only ([PROXY-SETUP.md](../docs/PROXY-SETUP.md)).
