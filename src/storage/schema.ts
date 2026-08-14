export const SCHEMA_VERSION = 2

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER NOT NULL
);
INSERT INTO schema_meta(version)
SELECT ${SCHEMA_VERSION} WHERE NOT EXISTS (SELECT 1 FROM schema_meta);
UPDATE schema_meta SET version = ${SCHEMA_VERSION} WHERE version < ${SCHEMA_VERSION};

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  confidence REAL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_json TEXT
);
CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope_key);
CREATE INDEX IF NOT EXISTS memories_rank ON memories(usage_count DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  scope_json TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_events_created ON memory_events(id DESC);
`
