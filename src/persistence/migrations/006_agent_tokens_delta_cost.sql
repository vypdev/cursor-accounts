-- Migration 006: Accumulated live delta cost per minute bucket
-- Version: 6

ALTER TABLE agent_tokens ADD COLUMN cost_cents REAL;
