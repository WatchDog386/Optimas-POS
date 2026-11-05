// What the shop server holds about parts: npm run sync:report
//
// Shows every till, the parts on the server, parts that were deleted (when,
// by which till and user), recent inventory activity, and serial labels whose
// part is missing. Use it to find out where parts went.
import { dbPath, migrate, sql } from '../server/db'

migrate()
const when = (t?: number | null) => (t ? new Date(t).toLocaleString('en-KE') : '—')
type Row = { key: string; data: string | null; till: number | null; user_id: number | null; updated_at: number }
const rows = (tbl: string) => sql.prepare('SELECT key, data, till, user_id, updated_at FROM sync_records WHERE tbl = ?').all(tbl) as Row[]
const users = new Map((sql.prepare('SELECT id, name FROM users').all() as { id: number; name: string }[]).map((u) => [u.id, u.name]))
const who = (id?: number | null) => (id ? (users.get(id) ?? `user ${id}`) : '—')

console.log(`Server database: ${dbPath}\n`)

console.log('TILLS')
for (const t of sql.prepare('SELECT number, last_seen FROM tills ORDER BY number').all() as { number: number; last_seen: number }[])
  console.log(`  Till #${t.number}  last seen ${when(t.last_seen)}`)

const products = rows('products')
const live = products.filter((r) => r.data)
const liveIds = new Set(live.map((r) => JSON.parse(r.key) as number))
console.log(`\nPARTS ON THE SERVER (${live.length})`)
for (const r of live.sort((a, b) => a.updated_at - b.updated_at)) {
  const p = JSON.parse(r.data!)
  console.log(`  ${String(p.sku).padEnd(10)} ${String(p.name).slice(0, 40).padEnd(40)} KES ${(p.price / 100).toFixed(0).padStart(7)}  from till #${r.till} at ${when(r.updated_at)}`)
}

const deleted = products.filter((r) => !r.data)
const saved = new Map(
  (sql.prepare("SELECT key, data FROM sync_deleted WHERE tbl = 'products' ORDER BY id").all() as { key: string; data: string }[]).map((r) => [r.key, JSON.parse(r.data)]),
)
console.log(`\nDELETED PARTS (${deleted.length})`)
for (const r of deleted.sort((a, b) => a.updated_at - b.updated_at)) {
  const p = saved.get(r.key)
  const name = p ? `${p.sku} ${p.name}` : `id ${r.key} (name not kept — deleted before this report existed)`
  console.log(`  ${name.slice(0, 60).padEnd(60)} deleted ${when(r.updated_at)} on till #${r.till} by ${who(r.user_id)}`)
}

console.log('\nRECENT INVENTORY ACTIVITY (newest last)')
const logs = rows('logs')
  .filter((r) => r.data)
  .map((r) => ({ ...JSON.parse(r.data!), till: r.till }))
  .filter((l) => l.kind === 'stock')
  .sort((a, b) => a.at - b.at)
  .slice(-40)
for (const l of logs) console.log(`  ${when(l.at)}  till #${l.till}  ${l.userName ?? ''}: ${l.action}${l.detail ? ` — ${l.detail}` : ''}`)

const orphans = new Map<number, number>()
for (const r of rows('units')) {
  if (!r.data) continue
  const u = JSON.parse(r.data)
  if (u.status === 'in_stock' && !liveIds.has(u.productId)) orphans.set(u.productId, (orphans.get(u.productId) ?? 0) + 1)
}
console.log(`\nSERIAL LABELS WHOSE PART IS MISSING (${[...orphans.values()].reduce((a, b) => a + b, 0)})`)
for (const [id, n] of orphans) console.log(`  part id ${id}: ${n} labels`)

const restorable = sql.prepare("SELECT COUNT(*) AS n FROM sync_deleted WHERE tbl = 'products'").get() as { n: number }
console.log(`\n${restorable.n} deleted part(s) can be restored with: npm run sync:restore`)
