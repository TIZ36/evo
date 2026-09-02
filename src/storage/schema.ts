export const SCHEMA_VERSION = 6

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

-- Skills are procedural SOPs, stored separately from declarative memories.
-- Keyed by (scope_key, name) — at most one skill per name per scope.
CREATE TABLE IF NOT EXISTS skills (
  scope_key TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  name TEXT NOT NULL,
  body_json TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_json TEXT,
  dormant INTEGER NOT NULL DEFAULT 0,
  promoted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope_key, name)
);
CREATE INDEX IF NOT EXISTS skills_scope ON skills(scope_key);
CREATE INDEX IF NOT EXISTS skills_rank ON skills(usage_count DESC, updated_at DESC);

-- Skill lessons: per-skill, per-use feedback appended over time.
CREATE TABLE IF NOT EXISTS skill_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  text TEXT NOT NULL,
  session_id TEXT,
  turn INTEGER,
  created_at INTEGER NOT NULL,
  folded INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (scope_key, skill_name) REFERENCES skills(scope_key, name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS skill_lessons_skill ON skill_lessons(scope_key, skill_name);

-- Replay buffer: raw distilled batches for slow-path consolidation.
-- Interleaved with current memories to give the consolidator more evidence.
CREATE TABLE IF NOT EXISTS replay_buffer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  batch_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS replay_buffer_scope ON replay_buffer(scope_key, consumed, created_at DESC);

-- Consolidation state: tracks when last consolidate ran and convergence.
CREATE TABLE IF NOT EXISTS consolidation_state (
  scope_key TEXT PRIMARY KEY,
  last_consolidate_at INTEGER NOT NULL DEFAULT 0,
  last_digest TEXT,
  converged INTEGER NOT NULL DEFAULT 0,
  convergence_multiplier REAL NOT NULL DEFAULT 1.0
);
`
