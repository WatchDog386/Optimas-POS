-- 003_sales.sql — server-side mirror of the till's sales (IndexedDB).
-- The till stays the source of truth for day-to-day use; this table is a
-- durable central copy the till pushes to and pulls from so the web and the
-- installed till share the same sales and stock.
CREATE TABLE IF NOT EXISTS sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no  TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  lines       TEXT    NOT NULL,        -- JSON array of SaleLine
  subtotal    INTEGER NOT NULL DEFAULT 0,
  discount    INTEGER NOT NULL DEFAULT 0,
  tax         INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  payments    TEXT    NOT NULL,        -- JSON array of Payment
  change      INTEGER NOT NULL DEFAULT 0,
  customer_id INTEGER,
  user_id     INTEGER NOT NULL,
  shift_id    INTEGER,
  status      TEXT    NOT NULL DEFAULT 'completed'
              CHECK (status IN ('completed', 'refunded', 'partially_refunded', 'voided')),
  note        TEXT,
  refund_of   INTEGER,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_receipt ON sales (receipt_no);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_user ON sales (user_id);
