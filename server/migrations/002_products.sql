-- 002_products.sql — server-side mirror of the till's product catalog.
-- The till (IndexedDB) stays the source of truth; this table is a durable
-- backup the till pushes on every save and clears on "Clear all".
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku           TEXT    NOT NULL UNIQUE,
  barcode       TEXT,
  name          TEXT    NOT NULL,
  category_id   INTEGER,
  brand         TEXT,
  part_number   TEXT,
  cost          INTEGER NOT NULL DEFAULT 0,
  price         INTEGER NOT NULL DEFAULT 0,
  stock         INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 2,
  active        INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products (active);
