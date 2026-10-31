-- 004_sync.sql — the server becomes the shared copy of every till's data.
--
-- sync_records holds the latest version of every synced record (sales,
-- products, stock movements, serial labels, customers, settings…). Each push
-- replaces the row and gives it a new, higher rev; tills pull everything above
-- the last rev they saw. Deletes are kept as rows with data = NULL
-- (tombstones) so a deleted part can never come back from another till.
CREATE TABLE IF NOT EXISTS sync_records (
  rev        INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl        TEXT    NOT NULL,
  key        TEXT    NOT NULL,              -- JSON-encoded primary key
  data       TEXT,                          -- JSON record, NULL = deleted
  till       INTEGER,                       -- till that made the change
  user_id    INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_records_key ON sync_records (tbl, key);

-- Every till that has connected; numbers are unique within the shop and are
-- part of receipt numbers, record IDs and serial barcodes.
CREATE TABLE IF NOT EXISTS tills (
  number     INTEGER PRIMARY KEY,
  label      TEXT,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

-- Superseded by sync_records.
DROP TABLE IF EXISTS products;
