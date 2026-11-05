// Restore deleted parts (with their serial labels and stock history) on the
// shop server; every till gets them back at its next sync.
//
//   npm run sync:restore                 list what can be restored
//   npm run sync:restore -- --all        restore every deleted part
//   npm run sync:restore -- --since 2026-10-25T08:00
import { migrate, sql } from '../server/db'

migrate()
const args = process.argv.slice(2)
const all = args.includes('--all')
const sinceArg = args[args.indexOf('--since') + 1]
const since = args.includes('--since') ? Date.parse(sinceArg) : NaN
if (args.includes('--since') && Number.isNaN(since)) throw new Error(`Bad --since date: ${sinceArg}`)

type Kept = { id: number; tbl: string; key: string; data: string; deleted_at: number }
const kept = sql.prepare('SELECT id, tbl, key, data, deleted_at FROM sync_deleted ORDER BY id').all() as Kept[]
const stillDeleted = (tbl: string, key: string) =>
  (sql.prepare('SELECT data FROM sync_records WHERE tbl = ? AND key = ?').get(tbl, key) as { data: string | null } | undefined)?.data == null

// Latest kept version of each record that is still deleted.
const latest = new Map<string, Kept>()
for (const k of kept) if (stillDeleted(k.tbl, k.key)) latest.set(`${k.tbl}|${k.key}`, k)
const parts = [...latest.values()].filter((k) => k.tbl === 'products' && (all || (!Number.isNaN(since) && k.deleted_at >= since)))
const candidates = [...latest.values()].filter((k) => k.tbl === 'products')

if (!all && Number.isNaN(since)) {
  console.log(`${candidates.length} deleted part(s) can be restored:`)
  for (const k of candidates) {
    const p = JSON.parse(k.data)
    console.log(`  ${p.sku}  ${p.name}  (deleted ${new Date(k.deleted_at).toLocaleString('en-KE')})`)
  }
  console.log('\nRun with --all, or --since <date/time>, to restore them.')
  process.exit(0)
}

const ids = new Set(parts.map((k) => JSON.parse(k.data).id as number))
const put = sql.prepare(
  `INSERT OR REPLACE INTO sync_records (tbl, key, data, till, user_id, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)`,
)
let n = 0
sql.transaction(() => {
  for (const k of latest.values()) {
    const d = JSON.parse(k.data)
    const belongs = k.tbl === 'products' ? ids.has(d.id) : (k.tbl === 'units' || k.tbl === 'movements') && ids.has(d.productId)
    if (!belongs) continue
    put.run(k.tbl, k.key, k.data, Date.now())
    n++
  }
})()
console.log(`Restored ${parts.length} part(s) (${n} records incl. labels and stock history). Tills get them at their next sync.`)
