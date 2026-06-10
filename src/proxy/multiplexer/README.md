# Proxy Multiplexor

Local TCP/HTTP router on port **9000** that assigns Cursor traffic to dedicated upstream MITM proxies created dynamically per `(profileId, workspacePath)`.

## Quick start

```typescript
import { buildMultiplexerConfig } from '../../application/types/multiplexerConfig';
import { createMultiplexerRuntime } from './factory';

const config = buildMultiplexerConfig();
const runtime = createMultiplexerRuntime(config);

await runtime.service.start(config);
// Upstreams are created on demand when workspace-path routing detects a workspace.
```

## Documentation

- [Architecture](../../../docs/PROXY-MULTIPLEXER-ARCHITECTURE.md)
- [Setup guide](../../../docs/PROXY-MULTIPLEXER-SETUP.md)
- [ADRs](../../../docs/PROXY-MULTIPLEXER-ADR.md)
