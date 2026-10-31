-- 003_production.sql — production release.
--  * Staff PINs are stored only as PBKDF2 records (pin_hash); the old table
--    held plain PINs and two demo accounts (1234 / 0000), so it is rebuilt empty.
--    The first till to sign in after this migration registers the real staff.
--  * The product mirror held demo/quotation parts; it is cleared.
--  * server_kv keeps server secrets (the token signing key).
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  active     INTEGER NOT NULL DEFAULT 1,
  -- PIN was issued by someone else / too weak: holder must replace it at sign-in.
  must_change_pin INTEGER NOT NULL DEFAULT 0,
  email      TEXT,
  phone      TEXT,
  about      TEXT,
  updated_at INTEGER NOT NULL
);

DELETE FROM products;

CREATE TABLE IF NOT EXISTS server_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
