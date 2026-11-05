-- 005_deleted.sql — keep the last version of every record a till deletes, so a
-- deleted part (with its serial labels and stock history) can be restored:
--   npm run sync:restore
CREATE TABLE IF NOT EXISTS sync_deleted (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl             TEXT    NOT NULL,
  key             TEXT    NOT NULL,
  data            TEXT    NOT NULL,   -- the record as it was before the delete
  deleted_at      INTEGER NOT NULL,
  deleted_by_till INTEGER,
  deleted_by_user INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sync_deleted_key ON sync_deleted (tbl, key);
CREATE INDEX IF NOT EXISTS idx_sync_deleted_at ON sync_deleted (deleted_at);
