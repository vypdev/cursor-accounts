-- Migration 009: Workspace tracking for per-project metrics
-- Version: 9

ALTER TABLE conversations ADD COLUMN workspace_path TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_path, last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_profile_workspace ON conversations(profile_id, workspace_path);

ALTER TABLE agents ADD COLUMN workspace_path TEXT;
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_path, started_at DESC);

ALTER TABLE agent_tokens_delta ADD COLUMN workspace_path TEXT;
CREATE INDEX IF NOT EXISTS idx_tokens_delta_workspace ON agent_tokens_delta(workspace_path, minute_bucket DESC);
