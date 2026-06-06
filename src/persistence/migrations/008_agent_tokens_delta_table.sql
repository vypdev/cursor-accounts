-- Migration 008: Agent tokens delta aggregation table
-- Version: 8

CREATE TABLE IF NOT EXISTS agent_tokens_delta (
  request_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  delta_tokens INTEGER NOT NULL DEFAULT 0,
  delta_cost REAL NOT NULL DEFAULT 0,
  context_used INTEGER,
  context_max INTEGER,
  PRIMARY KEY (request_id, minute_bucket),
  FOREIGN KEY (request_id) REFERENCES agents(request_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_tokens_delta_conversation ON agent_tokens_delta(conversation_id, minute_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_delta_bucket ON agent_tokens_delta(minute_bucket DESC);
