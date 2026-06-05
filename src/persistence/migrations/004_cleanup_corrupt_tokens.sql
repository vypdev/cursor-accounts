-- Migration 004: Clean up corrupted token values
-- Version: 4

DELETE FROM agent_tokens
WHERE token_type = 'turn_ended'
  AND (
    input_tokens > 50000000
    OR output_tokens > 50000000
    OR cache_read_tokens > 50000000
    OR cache_write_tokens > 50000000
    OR total_tokens > 50000000
  );
