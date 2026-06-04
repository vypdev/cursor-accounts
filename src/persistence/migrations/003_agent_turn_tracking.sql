-- Migration 003: Add turn tracking fields to agent_tokens
-- Version: 3

ALTER TABLE agent_tokens ADD COLUMN turn_index INTEGER;
ALTER TABLE agent_tokens ADD COLUMN http_request_id TEXT;

CREATE INDEX idx_tokens_turn ON agent_tokens(request_id, turn_index);
