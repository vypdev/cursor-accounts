-- Migration 001: Initial schema for prompt efficiency events
-- Version: 1

CREATE TABLE prompt_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  model_used TEXT NOT NULL,
  efficiency_score REAL NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL,
  task_type TEXT NOT NULL,
  repository_path TEXT,
  branch_name TEXT,
  conversation_id TEXT,
  scored_at INTEGER,
  required_tier INTEGER,
  actual_tier INTEGER,
  recommended_model TEXT,
  opinion TEXT,
  quota_percent_used REAL,
  quota_limit INTEGER,
  quota_remaining INTEGER,
  quota_cycle_start INTEGER,
  quota_cycle_end INTEGER,
  quota_is_enterprise INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_profile_timestamp ON prompt_events(profile_id, timestamp DESC);
CREATE INDEX idx_repository_branch ON prompt_events(repository_path, branch_name);
CREATE INDEX idx_profile_repo_branch ON prompt_events(profile_id, repository_path, branch_name);
CREATE INDEX idx_task_type ON prompt_events(task_type);
CREATE INDEX idx_efficiency_score ON prompt_events(efficiency_score);
CREATE INDEX idx_quota_percent ON prompt_events(profile_id, quota_percent_used);

CREATE TABLE database_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO database_metadata (key, value, updated_at)
VALUES ('schema_version', '1', strftime('%s', 'now'));
