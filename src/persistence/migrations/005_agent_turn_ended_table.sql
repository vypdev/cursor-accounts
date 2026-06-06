-- Migration 005: Minute-bucketed delta aggregation + agent_turn_ended table
-- Version: 5

ALTER TABLE agent_tokens ADD COLUMN minute_bucket INTEGER;

CREATE TABLE agent_turn_ended (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  total_tokens INTEGER,
  total_cents REAL,
  usage_uuid TEXT,
  recorded_at INTEGER NOT NULL,
  model_name TEXT,
  http_request_id TEXT,
  FOREIGN KEY (request_id) REFERENCES agents(request_id)
);

CREATE INDEX idx_turn_ended_request ON agent_turn_ended(request_id, recorded_at DESC);
CREATE INDEX idx_turn_ended_recorded ON agent_turn_ended(recorded_at DESC);

CREATE UNIQUE INDEX idx_tokens_delta_bucket ON agent_tokens(request_id, minute_bucket)
  WHERE token_type = 'delta' AND minute_bucket IS NOT NULL;

INSERT INTO agent_turn_ended (
  request_id,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  total_tokens,
  usage_uuid,
  recorded_at,
  model_name,
  http_request_id
)
SELECT
  request_id,
  COALESCE(input_tokens, 0),
  COALESCE(output_tokens, 0),
  cache_read_tokens,
  cache_write_tokens,
  total_tokens,
  usage_uuid,
  recorded_at,
  model_name,
  http_request_id
FROM agent_tokens
WHERE token_type = 'turn_ended';

DELETE FROM agent_tokens WHERE token_type = 'turn_ended';
