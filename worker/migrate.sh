#!/usr/bin/env bash
# 已存在的資料庫加欄位（重複執行會報「欄位已存在」，忽略即可）
# 用法：bash worker/migrate.sh --remote   或   bash worker/migrate.sh --local
loc="${1:---remote}"
run() { npx wrangler d1 execute taiwan-stock-auth "$loc" --command "$1" >/dev/null 2>&1 && echo "OK: $1" || echo "略過: $1"; }
run "ALTER TABLE keys ADD COLUMN username TEXT"
run "ALTER TABLE keys ADD COLUMN pin_hash TEXT"
run "ALTER TABLE keys ADD COLUMN pin_set_at INTEGER"
run "ALTER TABLE applications ADD COLUMN pin_hash TEXT"
run "CREATE UNIQUE INDEX IF NOT EXISTS idx_keys_username ON keys (username)"
run "ALTER TABLE sessions ADD COLUMN device_id TEXT"
