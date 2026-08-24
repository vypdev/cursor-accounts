-- Migration 009: Idempotent agent event persistence
-- Version: 9

ALTER TABLE agent_tokens ADD COLUMN event_key TEXT;
ALTER TABLE agent_turn_ended ADD COLUMN event_key TEXT;

CREATE UNIQUE INDEX idx_agent_tokens_event_key
  ON agent_tokens(event_key)
  WHERE event_key IS NOT NULL;

CREATE UNIQUE INDEX idx_agent_turn_ended_event_key
  ON agent_turn_ended(event_key)
  WHERE event_key IS NOT NULL;

-- Each live delta is recorded before it is folded into the minute aggregate.
-- The primary key makes replaying the same source event a no-op.
CREATE TABLE agent_tokens_delta_events (
  event_key TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  delta_tokens INTEGER NOT NULL,
  delta_cost REAL NOT NULL DEFAULT 0,
  context_used INTEGER,
  context_max INTEGER,
  recorded_at INTEGER,
  FOREIGN KEY (request_id) REFERENCES agents(request_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
);

CREATE INDEX idx_tokens_delta_events_request_bucket
  ON agent_tokens_delta_events(request_id, minute_bucket DESC);
