// Every stock change across the shop — sales, receipts, counts, write-offs —
// with who made it. The audit trail behind stock levels (and what syncs them).

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Search } from 'lucide-react'
import { db } from '../db/db'
import type { MovementReason, Product, StockMovement, User } from '../db/types'
import { download, toCsv } from '../lib/csv'
import { Badge, PageHeader } from '../components/ui'

const REASONS: { id: MovementReason; label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'blue' }[] = [
  { id: 'sale', label: 'Sale', tone: 'blue' },
  { id: 'refund', label: 'Refund', tone: 'slate' },
  { id: 'receive', label: 'Received', tone: 'green' },
  { id: 'count', label: 'Count', tone: 'slate' },
  { id: 'adjust', label: 'Adjustment', tone: 'amber' },
  { id: 'damage', label: 'Damaged / lost', tone: 'red' },
]
const RANGES = [
  { id: 1, label: 'Today' },
  { id: 7, label: 'Last 7 days' },
  { id: 30, label: 'Last 30 days' },
  { id: 0, label: 'All time' },
]
const LIMIT = 500

export default function StockMovementsPage() {
  const [days, setDays] = useState(7)
  const [reason, setReason] = useState<MovementReason | 'all'>('all')
  const [q, setQ] = useState('')

  const since = useMemo(() => {
    if (!days) return 0
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime() - (days - 1) * 86_400_000
  }, [days])

  const moves = useLiveQuery(() => db.movements.where('at').aboveOrEqual(since).reverse().sortBy('at'), [since], [] as StockMovement[])
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[])
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products])
  const userName = (id?: number) => (id ? users.find((u) => u.id === id)?.name ?? `User ${id}` : '—')

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return moves.filter((m) => {
      if (reason !== 'all' && m.reason !== reason) return false
      if (!t) return true
      const p = productById.get(m.productId)
      return [p?.name, p?.sku, m.reference, m.note].some((v) => v?.toLowerCase().includes(t))
    })
  }, [moves, reason, q, productById])

  const totals = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of rows) out[m.reason] = (out[m.reason] ?? 0) + m.change
    return out
  }, [rows])

  const exportCsv = () =>
    download(
      `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([
        ['time', 'sku', 'part', 'reason', 'change', 'reference', 'note', 'by'],
        ...rows.map((m) => {
          const p = productById.get(m.productId)
          return [new Date(m.at).toLocaleString('en-KE'), p?.sku, p?.name ?? '(deleted part)', m.reason, m.change, m.reference, m.note, userName(m.userId)]
        }),
      ]),
    )

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Stock Movements"
        subtitle="Every change to stock — sales, deliveries, counts and write-offs — with who made it."
        actions={
          <button className="btn-ghost" onClick={exportCsv} disabled={rows.length === 0}>
            <Download size={16} /> Export CSV
          </button>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {REASONS.map((r) => (
          <button
            key={r.id}
            onClick={() => setReason(reason === r.id ? 'all' : r.id)}
            className={`rounded-xl border bg-white px-3 py-2.5 text-left shadow-card transition ${reason === r.id ? 'border-brand-500 ring-1 ring-brand-500' : 'border-hairline hover:border-brand-300'}`}
          >
            <div className="text-xs text-slate-500">{r.label}</div>
            <div className={`text-lg font-bold tabular-nums ${(totals[r.id] ?? 0) < 0 ? 'text-red-600' : 'text-slate-800'}`}>
              {(totals[r.id] ?? 0) > 0 ? '+' : ''}
              {totals[r.id] ?? 0}
            </div>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72 max-w-full">
          <Search size={14} className="absolute left-3 top-3 text-slate-400" />
          <input className="input pl-9" placeholder="Part, SKU, receipt or PO number…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-500">
          {rows.length > LIMIT ? `Showing the latest ${LIMIT} of ${rows.length}` : `${rows.length} movements`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-hairline bg-white shadow-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2.5">When</th>
              <th className="px-3 py-2.5">Part</th>
              <th className="px-3 py-2.5">Reason</th>
              <th className="px-3 py-2.5">Reference</th>
              <th className="px-3 py-2.5">By</th>
              <th className="px-4 py-2.5 text-right">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, LIMIT).map((m) => {
              const p = productById.get(m.productId)
              const r = REASONS.find((x) => x.id === m.reason)
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-600">{new Date(m.at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{p?.name ?? 'Deleted part'}</div>
                    <div className="font-mono text-[11px] text-slate-500">{p?.sku}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r?.tone ?? 'slate'}>{r?.label ?? m.reason}</Badge>
                    {m.note && <div className="mt-0.5 text-xs text-slate-500">{m.note}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{m.reference ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{userName(m.userId)}</td>
                  <td className={`px-4 py-2 text-right font-bold tabular-nums ${m.change < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {m.change > 0 ? '+' : ''}
                    {m.change}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No stock movements in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
