# Cursor `aiserver.v1` protos (extracted)

Protobuf schemas reverse-engineered from the **local Cursor IDE install**, for MITM proxy decode (Connect-RPC / `application/connect+proto`).

## Regenerate

```bash
pnpm run extract:protos
# or
node scripts/extract-cursor-protos.mjs /Applications/Cursor.app
```

Requires a installed Cursor app. On macOS the default path is `/Applications/Cursor.app`.

Output:

- `aiserver/v1/aiserver.proto` — messages, enums, and RPC services
- `aiserver/v1/cursor-version.txt` — Cursor version used for extraction

## Source

Descriptors are parsed from:

`Cursor.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js`

That bundle embeds `@bufbuild/protobuf` message classes (`typeName`, `fields`, services).

## Notes

- Schemas are tied to your Cursor version; re-run after IDE upgrades.
- Nested types use flattened names (`GetCurrentPeriodUsageResponse_PlanUsage`).
- Not an official Cursor API; for research/debug only (see [PROXY-SETUP.md](../docs/PROXY-SETUP.md)).
