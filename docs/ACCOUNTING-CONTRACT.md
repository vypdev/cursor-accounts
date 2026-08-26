# Token and Cost Accounting Contract

This document defines the accounting semantics for captured Cursor agent
traffic. It is deliberately independent of the current UI wording and model
catalog implementation so that storage, reconciliation, and presentation can
be tested against the same rules.

## Event classes

| Event | Meaning | Persistence rule |
|---|---|---|
| `token_delta` | Incremental streaming progress | Persist as an idempotent minute-bucket delta. Its cost is provisional and must never be added to the final turn cost. |
| `token_details` | Context-window observation | Persist only context usage (`used` and `max`); it is not billable usage. |
| `turn_ended` | Server-reported completed turn | Persist one immutable completion row per source event. This is the billing-grade record. |
| Snapshot/batch token event | Non-streaming or replayed usage evidence | Persist only when it contains usable token fields and protect it with a stable event key when available. |

## Cost precedence

For a completed turn, the precedence order is:

1. A finite, non-negative `total_cents` supplied by the server.
2. A model-aware calculation from the captured input/output/cache breakdown.
3. No cost value when no calculator is available or the calculation is not
   valid.

The server value is authoritative even when it is zero. A negative or
non-finite server value is treated as invalid and cannot be persisted as a
billing result.

For a live delta, the event's already calculated `deltaCostCents` is preferred;
otherwise the domain calculator estimates the delta. Live estimates are stored
separately from completed-turn costs to prevent double counting.

## Pricing catalog provenance

Model-aware estimates come from the `IModelPricingProvider` port. Providers must
expose immutable catalog metadata containing:

- a catalog version identifying the exact reviewed snapshot;
- the official source URL;
- the retrieval date; and
- the declared coverage of the snapshot.

The current Cursor adapter uses catalog version `cursor-docs-2026-08-26` and
the official [Models & Pricing documentation](https://cursor.com/docs/models-and-pricing).
Normal `Auto` routing has no single fixed price, because Cursor charges the
model selected for each request. The fixed `Legacy Enterprise Auto` rate is
kept under explicit legacy IDs and hidden by default.

The snapshot version is currently available at the provider boundary. A
follow-up SQLite migration must persist the version and calculation source on
each calculated cost before historical cost reports can be treated as
reproducible billing evidence.

## Token normalization

Token counts used for cost calculations must be finite and positive. Missing,
negative, `NaN`, and infinite values are treated as zero. The accounting layer
never emits a negative or non-finite cost.

When a known model has no published cache rate for a cache component, that
component remains visible in token totals but is excluded from the model-aware
cost estimate. Unknown models use the configured fallback rate across the
available token total.

The domain accepts only safe non-negative integer token counts. Invalid counts
are discarded at the application boundary and never reach SQLite. Cost values
are non-negative finite numbers expressed in USD cents. Estimates retain six
decimal places of a cent to remove binary floating-point noise without
rounding small estimates to zero or to a whole cent. The server's
`total_cents` value is normalized with the same precision while preserving an
authoritative zero.

Legacy JSON and Connect shapes are normalized before accounting. The extractor
accepts snake_case and camelCase input/output/cache fields, direct usage
objects, and nested `metadata.token_usage` / `metadata.tokenUsage` objects.
`cachedTokens` remains a compatibility alias for cache-read tokens; explicit
`cacheReadTokens` and `cacheWriteTokens` are retained when supplied.

## Reconciliation invariants

- Replaying the same event key does not change any aggregate or completion total.
- A minute bucket contains the sum of distinct live increments for its request.
- A completion row is not folded into live delta totals.
- Conversation totals expose live delta tokens/cost and completed-turn
  tokens/cost as separate fields.
- Every persisted cost is finite and greater than or equal to zero.
- A missing model or missing server cost is observable through the fallback
  path; it is never silently represented as a fabricated server charge.

The executable tests in `src/test/services/agentTrackingPersistenceWriter.test.ts`,
`src/test/domain/services/ProxyLiveCostCalculator.test.ts`, and
`src/test/agentTrackingIntegration.test.ts` are the current golden regression
suite for these rules. Fixtures must remain redacted: identifiers are synthetic
and no authorization headers, prompts, file paths, or captured bodies belong in
the corpus.
