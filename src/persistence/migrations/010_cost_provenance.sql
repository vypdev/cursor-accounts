-- Migration 010: Cost provenance for persisted usage
-- Version: 10

ALTER TABLE agent_turn_ended ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE agent_turn_ended ADD COLUMN pricing_snapshot_version TEXT;

ALTER TABLE agent_tokens_delta ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE agent_tokens_delta ADD COLUMN pricing_snapshot_version TEXT;

ALTER TABLE agent_tokens_delta_events ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE agent_tokens_delta_events ADD COLUMN pricing_snapshot_version TEXT;
