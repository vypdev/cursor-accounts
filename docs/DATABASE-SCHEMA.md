# Database Schema — Agent Tracking

Reference for agent/conversation/token tables in `cursor-accounts-efficiency.db`.

**Last reviewed:** 2026-06-04

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

Stores token usage snapshots for agents, with support for multi-turn tracking within a single bidi session.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment row id |
| request_id | TEXT FK | Bidi agent session id |
| token_type | TEXT | `delta`, `turn_ended`, or `token_details` |
| streaming_tokens | INTEGER | Live counter from `token_delta` |
| input_tokens | INTEGER | Billed input (from `turn_ended`) |
| output_tokens | INTEGER | Billed output (from `turn_ended`) |
| cache_read_tokens | INTEGER | Cache read tokens |
| cache_write_tokens | INTEGER | Cache write tokens |
| total_tokens | INTEGER | Resolved total for the snapshot |
| usage_uuid | TEXT | Optional usage uuid from stream |
| recorded_at | INTEGER | Unix seconds |
| model_name | TEXT | Model at snapshot time |
| turn_index | INTEGER | Turn sequence within `request_id` (0 = first turn). NULL for single-event snapshots. |
| http_request_id | TEXT | HTTP `x-request-id` for RunSSE request/response correlation (audit/debug). |

### Turn tracking

**Primary (live):** Rows with `token_type = 'turn_ended'` are inserted when the MITM decoder sees server `InteractionUpdate.turn_ended` (`StreamingAgentDecoder`). These rows carry final input/output/cache fields; `turn_index` is often NULL.

**Secondary (batch heuristic):** When ingesting a full RunSSE body with multiple `token_delta` frames, `TokenTurnDetectionService` may assign `turn_index` using peak ≥ **300** and reset ≤ **150**. This path is for offline replay, not live status bar billing.

**RunPoll (HTTP/1):** Each `RunPoll` response typically produces one snapshot; `turn_index` is usually NULL.

### Example query

```sql
SELECT request_id, turn_index, streaming_tokens, http_request_id, recorded_at
FROM agent_tokens
WHERE request_id = 'abc123'
ORDER BY turn_index ASC;
```

---

## Migrations

| Version | File | Description |
|---------|------|-------------|
| 1 | `001_initial_schema.sql` | Efficiency scoring tables |
| 2 | `002_agent_tracking.sql` | conversations, agents, agent_tokens |
| 3 | `003_agent_turn_tracking.sql` | `turn_index`, `http_request_id` on agent_tokens |

---

## Related docs

- [TOKENS-AND-USAGE.md](TOKENS-AND-USAGE.md) — token signal semantics
- [PROXY-AGENT-IDS-AND-SUBAGENTS.md](PROXY-AGENT-IDS-AND-SUBAGENTS.md) — request_id vs conversation_id
- [ARCHITECTURE.md](ARCHITECTURE.md) — Clean Architecture layers
