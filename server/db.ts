// Server-side database (SQLite via better-sqlite3).
// Holds the things the till needs shared/durable on the server: M-Pesa payment
// prompts, staff users and shop settings. Sales/inventory stay in the browser's
// IndexedDB — see docs/MPESA.md and the README section on hosting.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

try {
  process.loadEnvFile()
} catch {
  // No .env file; rely on the real environment.
}

const here = path.dirname(fileURLToPath(import.meta.url))

/** Path of the SQLite file — override with DB_PATH in .env. */
export const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(here, '..', 'data', 'optimas.db')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

export const sql = new Database(dbPath)
sql.pragma('journal_mode = WAL')

/**
 * Apply every server/migrations/*.sql file that hasn't run yet, in filename
 * order, each in its own transaction. Runs on server boot and via
 * `npm run db:migrate`. Returns the migrations that were applied.
 */
export function migrate(): string[] {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)
  const applied = new Set(
    (sql.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version),
  )
  const dir = path.join(here, 'migrations')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const ran: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const script = fs.readFileSync(path.join(dir, file), 'utf8')
    sql.transaction(() => {
      sql.exec(script)
      sql.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, Date.now())
    })()
    ran.push(file)
  }
  return ran
}

/** True when the migration file has been applied (used by tests/tools). */
export function isMigrated(version: string): boolean {
  const row = sql.prepare('SELECT 1 AS ok FROM schema_migrations WHERE version = ?').get(version)
  return !!row
}
