CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  input_method TEXT NOT NULL,
  input_text TEXT,
  file_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error_message TEXT,
  result_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
