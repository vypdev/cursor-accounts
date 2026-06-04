-- Migration 002: Agent tracking (conversations, agents, token snapshots)
-- Version: 2

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  message_count INTEGER
);

CREATE INDEX idx_conversations_profile ON conversations(profile_id, last_activity DESC);

CREATE TABLE agents (
  request_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  conversation_group_id TEXT,
  parent_request_id TEXT,
  subagent_request_id TEXT,
  model_name TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  is_eof INTEGER DEFAULT 0,
  profile_id TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id),
  FOREIGN KEY (parent_request_id) REFERENCES agents(request_id)
);

CREATE INDEX idx_agents_conversation ON agents(conversation_id, started_at DESC);
CREATE INDEX idx_agents_parent ON agents(parent_request_id);
CREATE INDEX idx_agents_profile ON agents(profile_id, started_at DESC);
CREATE INDEX idx_agents_group ON agents(conversation_group_id);

CREATE TABLE agent_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  token_type TEXT NOT NULL,
  streaming_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  total_tokens INTEGER,
  usage_uuid TEXT,
  recorded_at INTEGER NOT NULL,
  model_name TEXT,
  FOREIGN KEY (request_id) REFERENCES agents(request_id)
);

CREATE INDEX idx_tokens_request ON agent_tokens(request_id, recorded_at DESC);
CREATE INDEX idx_tokens_type ON agent_tokens(token_type);
CREATE INDEX idx_tokens_uuid ON agent_tokens(usage_uuid);
