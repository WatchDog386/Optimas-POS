-- 001_init.sql — first server schema (payments, users, settings).
-- Money is whole shillings on the wire; the till keeps integer cents internally.

-- Every STK prompt the till raises through the PinnovaTech pay gateway.
CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id            TEXT PRIMARY KEY,                 -- checkoutRequestId shown to the till
  gateway_id    TEXT,                              -- id returned by optimus.pinnovatech.co.ke
  reference     TEXT,
  phone         TEXT NOT NULL,
  amount        INTEGER NOT NULL,                  -- whole KES
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'success', 'failed')),
  receipt       TEXT,                              -- M-Pesa receipt / confirmation code
  message       TEXT,
  request_json  TEXT,                              -- what we sent to the gateway
  response_json TEXT,                              -- what it replied
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mpesa_created ON mpesa_transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_mpesa_phone   ON mpesa_transactions (phone);

-- Staff — mirrors the till's IndexedDB `users` table.
-- The till pushes users here (PUT /api/users); PINs are stored but never
-- returned by GET /api/users so they can't be scraped off the public URL.
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  pin        TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  active     INTEGER NOT NULL DEFAULT 1,
  email      TEXT,
  phone      TEXT,
  about      TEXT,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_users_pin ON users (pin);

-- Shop settings — a single JSON document (the same shape as the till's
-- DEFAULT_SETTINGS in src/db/settings.ts).
CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Products — mirror of the till's IndexedDB `products` table, for server-side
-- persistence and till-push sync.  `sku` is the natural key; `id` auto‑increments
-- for the server row but the till always references by `sku`.
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku         TEXT    NOT NULL UNIQUE,
  barcode     TEXT,
  name        TEXT    NOT NULL,
  category_id INTEGER,
  brand       TEXT,
  part_number TEXT,
  cost        INTEGER NOT NULL DEFAULT 0,   -- whole shillings on wire
  price       INTEGER NOT NULL DEFAULT 0,
  stock       INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER DEFAULT 2,
  active      INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products (active);
