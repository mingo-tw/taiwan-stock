CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
INSERT OR IGNORE INTO settings (k, v) VALUES ('auth_mode', 'open'), ('idle_seconds', '180');

CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,          -- 末 4 碼，方便辨識
  label TEXT NOT NULL DEFAULT '',  -- 發給誰
  created_at INTEGER NOT NULL,
  expires_at INTEGER,              -- NULL = 不過期
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  device TEXT, ip TEXT, country TEXT,
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT                  -- logout / takeover / forced / disabled
);
CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions (key_id, ended_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  key_id INTEGER,
  type TEXT NOT NULL,              -- login / denied_busy / denied_invalid / logout / takeover / forced / expired_key
  device TEXT, ip TEXT, country TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',   -- 聯絡方式／備註（選填）
  ip TEXT, device TEXT, country TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
  decided_at INTEGER,
  key_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications (status, created_at);

-- 「我的持股」：每個帳號一份，換裝置登入也看得到。data 是 JSON，version 用來避免兩台裝置同時改而覆蓋
CREATE TABLE IF NOT EXISTS positions (
  key_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
