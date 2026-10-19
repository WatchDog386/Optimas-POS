import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import type { PaymentMethod, Product, Sale, SaleLine } from '../db/types'
import { money, moneyShort } from '../lib/money'
import { download, toCsv } from '../lib/csv'
import { Badge, Empty, PageHeader } from '../components/ui'
import { rangeStart } from './SalesPage'

const RANGES = { today: 'Today', week: '7 days', month: '30 days', all: 'All time' } as const
type Range = keyof typeof RANGES
const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', account: 'On account' }

/** Line value that keeps its sign, so refund lines (negative qty) subtract. */
const signedLine = (l: SaleLine) => l.qty * l.unitPrice - l.discount

/** Revenue net of VAT and the share of the cart discount, used for gross profit. */
function saleProfit(s: Sale): { revenueExVat: number; cost: number } {
  const exVat = s.total - s.tax
  const cost = s.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0)
  return { revenueExVat: exVat, cost }
}

export default function ReportsPage() {
  const settings = useSettings()
  const [range, setRange] = useState<Range>('week')
  const sales = useLiveQuery(() => db.sales.where('createdAt').aboveOrEqual(rangeStart(range)).toArray(), [range], [] as Sale[])
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  const stats = useMemo(() => {
    const valid = sales.filter((s) => s.status !== 'voided')
    const positive = valid.filter((s) => s.total >= 0)
    const net = valid.reduce((s, x) => s + x.total, 0)
    const tax = valid.reduce((s, x) => s + x.tax, 0)
    const refunds = valid.filter((s) => s.total < 0).reduce((s, x) => s - x.total, 0)
    let revenue = 0
    let cost = 0
    for (const s of valid) {
      const p = saleProfit(s)
      revenue += p.revenueExVat
      cost += p.cost
    }
    const byMethod: Record<PaymentMethod, number> = { cash: 0, mpesa: 0, card: 0, account: 0 }
    for (const s of valid) {
      for (const p of s.payments) byMethod[p.method] += p.amount
      byMethod.cash -= s.change
    }

    const byProduct = new Map<string, { name: string; qty: number; revenue: number; productId?: number }>()
    for (const s of valid)
      for (const l of s.lines) {
        const key = l.productId ? `p${l.productId}` : `n${l.name}`
        const row = byProduct.get(key) ?? { name: l.name, qty: 0, revenue: 0, productId: l.productId }
        row.qty += l.qty
        row.revenue += signedLine(l)
        byProduct.set(key, row)
      }
    const top = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10)

    const catOf = Object.fromEntries(products.map((p) => [p.id, p.categoryId]))
    const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]))
    const byCat = new Map<string, number>()
    for (const s of valid)
      for (const l of s.lines) {
        const name = l.productId ? catName[catOf[l.productId] ?? -1] ?? 'Uncategorised' : 'Custom / labour'
        byCat.set(name, (byCat.get(name) ?? 0) + signedLine(l))
      }

    // Daily series for the chart.
    const days: { label: string; total: number }[] = []
    const n = range === 'today' ? 1 : range === 'week' ? 7 : range === 'month' ? 30 : 30
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(start.getTime() - i * 86400000)
      const next = d.getTime() + 86400000
      days.push({
        label: d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
        total: valid.filter((s) => s.createdAt >= d.getTime() && s.createdAt < next).reduce((x, s) => x + s.total, 0),
      })
    }

    return {
      net,
      tax,
      refunds,
      profit: revenue - cost,
      margin: revenue ? Math.round(((revenue - cost) / revenue) * 100) : 0,
      count: positive.length,
      avg: positive.length ? Math.round(positive.reduce((s, x) => s + x.total, 0) / positive.length) : 0,
      byMethod,
      top,
      byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
      days,
    }
  }, [sales, products, categories, range])

  const low = products.filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel).sort((a, b) => a.stock - b.stock)

  const exportLines = () => {
    const rows = [['receipt', 'date', 'sku', 'item', 'qty', 'unit_price', 'line_discount', 'line_total', 'unit_cost']]
    for (const s of sales)
      for (const l of s.lines)
        rows.push([
          s.receiptNo,
          new Date(s.createdAt).toISOString(),
          l.sku ?? '',
          l.name,
          String(l.qty),
          String(l.unitPrice / 100),
          String(l.discount / 100),
          String((l.qty * l.unitPrice - l.discount) / 100),
          String(l.unitCost / 100),
        ])
    download(`sales-lines-${range}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows))
  }

  const c = settings.currency
  const maxDay = Math.max(1, ...stats.days.map((d) => d.total))
  const maxMethod = Math.max(1, ...Object.values(stats.byMethod))
  const maxCat = Math.max(1, ...stats.byCat.map(([, v]) => v))

  return (
    <div className="p-6">
      <PageHeader
        title="Reports"
        subtitle="Sales, profit, VAT and stock health"
        actions={
          <>
            <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <button key={r} onClick={() => setRange(r)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${range === r ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
                  {RANGES[r]}
                </button>
              ))}
            </div>
            <button className="btn-ghost" onClick={exportLines}>
              <Download size={16} /> Export CSV
            </button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Net sales" value={money(stats.net, c)} />
        <Kpi label="Gross profit (ex VAT)" value={money(stats.profit, c)} sub={`${stats.margin}% margin`} />
        <Kpi label="Transactions" value={String(stats.count)} sub={`avg ${money(stats.avg, c)}`} />
        <Kpi label="VAT collected" value={money(stats.tax, c)} sub="for KRA returns" />
        <Kpi label="Refunds" value={money(stats.refunds, c)} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Net sales by day</h2>
          <div className="flex h-48 items-end gap-[2px]">
            {stats.days.map((d) => (
              <div key={d.label} className="group relative flex h-full flex-1 flex-col justify-end">
                <div className="rounded-t bg-brand-500 transition group-hover:bg-brand-600" style={{ height: `${(Math.max(0, d.total) / maxDay) * 100}%`, minHeight: d.total > 0 ? 2 : 0 }} />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover:block">
                  {d.label}: {money(d.total, c)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>{stats.days[0]?.label}</span>
            <span>{stats.days[stats.days.length - 1]?.label}</span>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Takings by payment method</h2>
          <div className="space-y-3">
            {(Object.keys(stats.byMethod) as PaymentMethod[]).map((m) => (
              <BarRow key={m} label={METHOD_LABEL[m]} value={money(stats.byMethod[m], c)} pct={(Math.max(0, stats.byMethod[m]) / maxMethod) * 100} />
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Top sellers</h2>
          {stats.top.length === 0 && <Empty>No sales yet.</Empty>}
          <ol className="space-y-2 text-sm">
            {stats.top.map((t, i) => (
              <li key={t.name} className="flex justify-between gap-2">
                <span className="truncate">
                  <span className="mr-2 text-slate-400">{i + 1}.</span>
                  {t.name}
                </span>
                <span className="whitespace-nowrap text-slate-600">
                  {t.qty} · <b className="text-slate-900">{moneyShort(t.revenue)}</b>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Sales by category</h2>
          <div className="space-y-3">
            {stats.byCat.map(([name, v]) => (
              <BarRow key={name} label={name} value={moneyShort(v)} pct={(Math.max(0, v) / maxCat) * 100} />
            ))}
          </div>
          {stats.byCat.length === 0 && <Empty>No sales yet.</Empty>}
        </section>
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Reorder now ({low.length})</h2>
          <div className="max-h-72 space-y-2 overflow-y-auto text-sm">
            {low.map((p) => (
              <div key={p.id} className="flex justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <Badge tone={p.stock <= 0 ? 'red' : 'amber'}>
                  {p.stock} / {p.reorderLevel}
                </Badge>
              </div>
            ))}
            {low.length === 0 && <Empty>All parts above reorder level.</Empty>}
          </div>
        </section>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function BarRow({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-2 rounded bg-slate-100">
        <div className="h-2 rounded bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
