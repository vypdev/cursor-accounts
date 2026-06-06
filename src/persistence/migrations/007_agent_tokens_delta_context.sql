-- Migration 007: Context snapshot on minute-bucketed delta rows
-- Version: 7

ALTER TABLE agent_tokens ADD COLUMN context_used_tokens INTEGER;
ALTER TABLE agent_tokens ADD COLUMN context_max_tokens INTEGER;
