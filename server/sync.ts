// Till ⇄ server synchronisation (see server/migrations/004_sync.sql).

import express, { type Express, type RequestHandler } from 'express'
import { sql } from './db'
import type { AuthedRequest, Role } from './auth'

export const SYNC_TABLES = new Set([
  'categories',
  'suppliers',
  'products',
  'customers',
  'sales',
  'parked',
  'movements',
  'purchaseOrders',
  'shifts',
  'jobs',
  'logs',
  'units',
  'kv',
])
const SYNCED_KV_KEYS = new Set(['settings'])

/** Catalogue and configuration only managers and owners may change. */
const MANAGER_TABLES = new Set(['products', 'categories', 'suppliers', 'purchaseOrders'])

const MAX_TILL = 63
const PULL_PAGE = 500

interface Change {
  t: string
  k: unknown
  d: unknown
}

type Verdict = 'store' | 'ignore' | string

/** Decide what to do with one pushed change. Anything other than store/ignore is an error message. */
export function checkChange(c: Change, role: Role): Verdict {
  if (!c || typeof c.t !== 'string' || !SYNC_TABLES.has(c.t)) return 'unknown table'
  if (typeof c.k !== 'number' && typeof c.k !== 'string') return 'bad key'
  if (c.d !== null && (typeof c.d !== 'object' || Array.isArray(c.d))) return 'bad record'
  if (c.d !== null) {
    const pk = c.t === 'kv' ? (c.d as { key?: unknown }).key : (c.d as { id?: unknown }).id
    if (pk !== c.k) return 'record key does not match'
  }
  if (c.t === 'kv') {
    if (!SYNCED_KV_KEYS.has(String(c.k))) return 'ignore'
    return role === 'owner' ? 'store' : 'ignore'
  }
  // Cashiers' tills still record catalogue edits locally (a sale updates the
  // product's stock); those are ignored here — stock is rebuilt from movements.
  if (role === 'cashier' && MANAGER_TABLES.has(c.t)) return 'ignore'
  if (role === 'cashier' && c.d === null && c.t !== 'parked') return 'ignore'
  return 'store'
}

export function registerSyncRoutes(app: Express, staff: RequestHandler) {
  const push = sql.prepare(
    `INSERT OR REPLACE INTO sync_records (tbl, key, data, till, user_id, updated_at)
     VALUES (@tbl, @key, @data, @till, @user_id, @updated_at)`,
  )

  // Big limit: product photos travel as data URLs.
  app.post('/api/sync/push', express.json({ limit: '25mb' }), staff, (req: AuthedRequest, res) => {
    const { till, changes } = (req.body ?? {}) as { till?: unknown; changes?: unknown }
    if (!Number.isInteger(till) || (till as number) < 0 || (till as number) > MAX_TILL || !Array.isArray(changes) || changes.length > 1000) {
      res.status(400).json({ error: 'expected { till, changes[] } with at most 1000 changes' })
      return
    }
    const now = Date.now()
    let stored = 0
    let ignored = 0
    const rejected: { index: number; error: string }[] = []
    sql.transaction(() => {
      changes.forEach((raw, index) => {
        const c = raw as Change
        const verdict = checkChange(c, req.auth!.role)
        if (verdict === 'ignore') return void ignored++
        if (verdict !== 'store') return void rejected.push({ index, error: verdict })
        push.run({
          tbl: c.t,
          key: JSON.stringify(c.k),
          data: c.d === null ? null : JSON.stringify(c.d),
          till,
          user_id: req.auth!.uid,
          updated_at: now,
        })
        stored++
      })
      sql.prepare('UPDATE tills SET last_seen = ? WHERE number = ?').run(now, till)
    })()
    res.json({ stored, ignored, rejected })
  })

  app.get('/api/sync/pull', staff, (req, res) => {
    const since = Math.max(0, Number(req.query.since) || 0)
    const till = Number(req.query.till)
    const rows = sql
      .prepare(
        `SELECT rev, tbl, key, data FROM sync_records
         WHERE rev > ? AND (till IS NULL OR till != ?)
         ORDER BY rev LIMIT ?`,
      )
      .all(since, Number.isInteger(till) ? till : -1, PULL_PAGE) as { rev: number; tbl: string; key: string; data: string | null }[]
    const more = rows.length === PULL_PAGE
    const max = (sql.prepare('SELECT MAX(rev) AS m FROM sync_records').get() as { m: number | null }).m ?? 0
    res.json({
      changes: rows.map((r) => ({ rev: r.rev, t: r.tbl, k: JSON.parse(r.key), d: r.data === null ? null : JSON.parse(r.data) })),
      // Skip past this till's own changes at the end of the log too.
      last: more ? rows[rows.length - 1].rev : Math.max(since, max),
      more,
    })
  })

  /** A till claims a number (keeps its own when free) — unique within the shop. */
  app.post('/api/sync/till', staff, (req, res) => {
    const wanted = Number((req.body ?? {}).till)
    const label = String((req.body ?? {}).label ?? '').slice(0, 60) || null
    const now = Date.now()
    const taken = new Set((sql.prepare('SELECT number FROM tills').all() as { number: number }[]).map((r) => r.number))
    const known = (req.body ?? {}).known === true
    let number: number
    if (Number.isInteger(wanted) && wanted >= 1 && wanted <= MAX_TILL && (!taken.has(wanted) || known)) number = wanted
    else {
      number = 0
      for (let n = 1; n <= MAX_TILL; n++) if (!taken.has(n)) {
        number = n
        break
      }
      if (!number) {
        res.status(409).json({ error: `This shop already has ${MAX_TILL} tills registered` })
        return
      }
    }
    sql
      .prepare(
        `INSERT INTO tills (number, label, created_at, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT(number) DO UPDATE SET last_seen = excluded.last_seen, label = COALESCE(excluded.label, tills.label)`,
      )
      .run(number, label, now, now)
    res.json({ till: number })
  })

  /** What the server holds — shown under Settings → Sync. */
  app.get('/api/sync/status', staff, (_req, res) => {
    const counts = sql
      .prepare('SELECT tbl, COUNT(*) AS n FROM sync_records WHERE data IS NOT NULL GROUP BY tbl')
      .all() as { tbl: string; n: number }[]
    const tills = sql.prepare('SELECT number, label, last_seen FROM tills ORDER BY number').all()
    const rev = (sql.prepare('SELECT MAX(rev) AS m FROM sync_records').get() as { m: number | null }).m ?? 0
    res.json({ counts: Object.fromEntries(counts.map((c) => [c.tbl, c.n])), tills, rev })
  })
}
