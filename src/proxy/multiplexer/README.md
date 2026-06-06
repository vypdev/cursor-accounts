# Proxy Multiplexor

Local TCP/HTTP router that assigns Cursor windows to dedicated upstream MITM proxies.

## Quick start

```typescript
import { createMultiplexerRuntime } from './factory';

const runtime = createMultiplexerRuntime({
  router: { port: 9999, host: '127.0.0.1' },
  upstreams: [{ id: 'u1', host: '127.0.0.1', port: 8080 }],
  routing: { strategy: 'sticky-session' },
  health: { checkIntervalMs: 30000, timeoutMs: 5000, unhealthyThreshold: 3 },
});

await runtime.service.start(config);
```

## Documentation

- [Architecture](../../../docs/PROXY-MULTIPLEXER-ARCHITECTURE.md)
- [Setup guide](../../../docs/PROXY-MULTIPLEXER-SETUP.md)
- [ADRs](../../../docs/PROXY-MULTIPLEXER-ADR.md)
