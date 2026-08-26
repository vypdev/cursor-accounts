# Database Schema — Agent Tracking

Reference for agent/conversation/token tables in `cursor-accounts-efficiency.db`.

**Last reviewed:** 2026-08-24

---

## conversations

| Column | Type | Description |
|--------|------|-------------|
| conversation_id | TEXT PK | Stable chat tab id (`runRequest.conversationId`) |
| profile_id | TEXT | Extension profile that captured the traffic |
| created_at | INTEGER | Unix seconds |
| last_activity | INTEGER | Unix seconds of latest traffic |
| message_count | INTEGER | Optional message count from insights |

---

## agents

| Column | Type | Description |
|--------|------|-------------|
| request_id | TEXT PK | Bidi agent session id (parent or subagent) |
| conversation_id | TEXT FK | Chat tab this session belongs to |
| parent_request_id | TEXT FK | Parent agent when this is a subagent |
| subagent_request_id | TEXT | Subagent linkage from proto metadata |
| model_name | TEXT | Model observed on traffic |
| started_at | INTEGER | Unix seconds |
| ended_at | INTEGER | Unix seconds when session ended (`eof`) |
| is_eof | INTEGER | 1 when session marked complete |
| profile_id | TEXT | Extension profile |

---

## agent_tokens

Stores **aggregated live `token_delta`** rows and legacy offline replay snapshots.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment row id |
| request_id | TEXT FK | Bidi agent session id |
| token_type | TEXT | `delta` or `token_details` (live `turn_ended` moved to `agent_turn_ended`) |
| streaming_tokens | INTEGER | Sum of `token_delta` increments in the minute bucket |
| input_tokens | INTEGER | Legacy / offline fields only |
| output_tokens | INTEGER | Legacy / offline fields only |
| cache_read_tokens | INTEGER | Legacy / offline fields only |
| cache_write_tokens | INTEGER | Legacy / offline fields only |
| total_tokens | INTEGER | Resolved total for the snapshot |
| usage_uuid | TEXT | Optional usage uuid from stream |
| recorded_at | INTEGER | Unix seconds (equals `minute_bucket` for live deltas) |
| model_name | TEXT | Model at snapshot time |
| turn_index | INTEGER | Offline RunSSE replay turn grouping (batch heuristic) |
| http_request_id | TEXT | HTTP `x-request-id` for RunSSE correlation |
| minute_bucket | INTEGER | Unix seconds truncated to minute (`floor(ts/60)*60`) |
| event_key | TEXT | Stable source-event identity; unique when present |
| cost_cents | REAL | Sum of estimated live delta cost (USD cents) in the minute bucket |
| context_used_tokens | INTEGER | Context window usage at the latest event in this bucket |
| context_max_tokens | INTEGER | Context window size at the latest event in this bucket |
| cost_source | TEXT | `server`, `model_pricing`, `fallback`, `provided`, `unknown`, or `mixed` |
| pricing_snapshot_version | TEXT | Exact model-pricing snapshot used for the aggregate, when unambiguous |

### Live token_delta aggregation

Live `token_delta` events from `StreamingAgentDecoder` are **not** stored one row per event. `AgentTrackingService` sums increments into one row per `(request_id, minute_bucket)`:

- 100 `token_delta` events over 5 minutes → **5 rows** (not 100)
- UPSERT adds `latestDelta` to `streaming_tokens` within the same minute
- UPSERT adds per-delta `cost_cents` (from model pricing or proxy-enriched `deltaCostCents`) into `cost_cents` within the same minute
- UPSERT merges cost provenance; differing sources or pricing snapshots produce `mixed`
- UPSERT overwrites `context_used_tokens` / `context_max_tokens` with the latest snapshot from the proxy (`token_delta` or `token_details`)
- `recorded_at` stores the Unix seconds of the latest event in the bucket (used to pick the newest context for a conversation)

Unique index: `idx_tokens_delta_bucket` on `(request_id, minute_bucket)` where `token_type = 'delta'`.

`event_key` is protected by a partial unique index. It allows replayed snapshot
events to be ignored while preserving compatibility with legacy rows that do
not have an identity.

### Offline replay (batch)

When ingesting a full RunSSE body with `allTokenFrames[]`, `TokenTurnDetectionService` may still write legacy `delta` rows with `turn_index` (peak ≥ **300**, reset ≤ **150**). These rows have `minute_bucket = NULL`.

---

## agent_turn_ended

Billing-grade turn completions — **one row per server `turn_ended` event** (no aggregation).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment row id |
| request_id | TEXT FK | Bidi agent session id |
| input_tokens | INTEGER | Billed input tokens |
| output_tokens | INTEGER | Billed output tokens |
| cache_read_tokens | INTEGER | Cache read tokens |
| cache_write_tokens | INTEGER | Cache write tokens |
| total_tokens | INTEGER | Resolved billed total |
| total_cents | REAL | Server-reported cost in USD cents (when present) |
| cost_source | TEXT | Evidence source for `total_cents`; legacy rows default to `unknown` |
| pricing_snapshot_version | TEXT | Exact model-pricing snapshot used, when applicable |
| usage_uuid | TEXT | Optional usage uuid |
| recorded_at | INTEGER | Unix seconds |
| model_name | TEXT | Model at turn end |
| http_request_id | TEXT | HTTP `x-request-id` for RunSSE correlation |
| event_key | TEXT | Stable source-event identity; unique when present |

Inserted when the MITM decoder emits `isTurnEnded` / `InteractionUpdate.turn_ended`.
Repeated delivery of the same decoded event is ignored by `event_key`.

## agent_tokens_delta_events

This is the idempotency ledger for minute-bucketed live deltas. Each accepted
source event is inserted once, then its increment and cost are folded into
`agent_tokens_delta`. A replay that has the same `event_key` does not modify the
aggregate again. The ledger is intentionally separate from the aggregate so
that one minute can contain many independently identifiable events. It stores
the accepted event's `cost_source` and `pricing_snapshot_version` alongside
the numeric cost before aggregation.

---

## Querying by conversation_id

```sql
-- Live progress counter total (minute-bucketed deltas + cost)
SELECT COALESCE(SUM(t.streaming_tokens), 0) AS total_delta,
       COALESCE(SUM(t.cost_cents), 0) AS total_delta_cost_cents,
       COUNT(DISTINCT t.minute_bucket) AS minute_buckets
FROM agent_tokens t
JOIN agents a ON a.request_id = t.request_id
WHERE a.conversation_id = '<conversation_id>'
  AND t.token_type = 'delta'
  AND t.minute_bucket IS NOT NULL;

-- Billing-grade turn history
SELECT te.*
FROM agent_turn_ended te
JOIN agents a ON a.request_id = te.request_id
WHERE a.conversation_id = '<conversation_id>'
ORDER BY te.recorded_at DESC;
```

`AgentTrackingService.getConversationTokens()` returns both billed totals (`agent_turn_ended`) and `totalDeltaTokens` / `totalDeltaCostCents` / `deltaMinuteBuckets`, plus `latestContextUsedTokens` / `latestContextMaxTokens` from the most recent delta row with context for that conversation.

---

## Migrations

| Version | File | Description |
|---------|------|-------------|
| 1 | `001_initial_schema.sql` | Efficiency scoring tables |
| 2 | `002_agent_tracking.sql` | conversations, agents, agent_tokens |
| 3 | `003_agent_turn_tracking.sql` | `turn_index`, `http_request_id` on agent_tokens |
| 4 | `004_cleanup_corrupt_tokens.sql` | Remove corrupt `turn_ended` rows |
| 5 | `005_agent_turn_ended_table.sql` | `minute_bucket`, `agent_turn_ended`, migrate legacy `turn_ended` |
| 6 | `006_agent_tokens_delta_cost.sql` | Estimated live delta cost |
| 7 | `007_agent_tokens_delta_context.sql` | Context window fields |
| 8 | `008_agent_tokens_delta_table.sql` | Minute-bucketed delta aggregation table |
| 9 | `009_agent_event_idempotency.sql` | Event keys and the live-delta idempotency ledger |
| 10 | `010_cost_provenance.sql` | Cost source and pricing snapshot provenance for deltas and completed turns |

---

## Related docs

- [TOKENS-AND-USAGE.md](TOKENS-AND-USAGE.md) — token signal semantics
- [PROXY-AGENT-IDS-AND-SUBAGENTS.md](PROXY-AGENT-IDS-AND-SUBAGENTS.md) — request_id vs conversation_id
- [ACTIVE-CONVERSATION-DETECTION.md](ACTIVE-CONVERSATION-DETECTION.md) — focused chat tab id
- [ARCHITECTURE.md](ARCHITECTURE.md) — Clean Architecture layers
