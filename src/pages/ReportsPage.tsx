import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Banknote, Clock, Download, Percent, Receipt, TrendingUp, Trophy, Undo2 } from 'lucide-react'
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

/** Distinct, accessible palette shared by the charts. */
const PALETTE = ['#2480E8', '#2F8F54', '#FABF24', '#E23C37', '#7C5CE0', '#1AA5A5', '#E2725B', '#4A7BD8']
const METHOD_COLOR: Record<PaymentMethod, string> = { cash: '#2F8F54', mpesa: '#2480E8', card: '#7C5CE0', account: '#FABF24' }

/** Line value that keeps its sign, so refund lines (negative qty) subtract. */
const signedLine = (l: SaleLine) => l.qty * l.unitPrice - l.discount

/** Revenue net of VAT and the share of the cart discount, used for gross profit. */
function saleProfit(s: Sale): { revenueExVat: number; cost: number } {
  const exVat = s.total - s.tax
  const cost = s.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0)
  return { revenueExVat: exVat, cost }
}

const pct = (v: number, total: number) => (total > 0 ? Math.max(0, (v / total) * 100) : 0)

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
    const days: { label: string; total: number; full: string }[] = []
    const n = range === 'today' ? 1 : range === 'week' ? 7 : range === 'month' ? 30 : 30
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(start.getTime() - i * 86400000)
      const next = d.getTime() + 86400000
      days.push({
        label: d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
        full: d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }),
        total: valid.filter((s) => s.createdAt >= d.getTime() && s.createdAt < next).reduce((x, s) => x + s.total, 0),
      })
    }

    // Hour-of-day series (busy hours).
    const hours = Array.from({ length: 24 }, (_, h) => ({
      h,
      total: valid.filter((s) => new Date(s.createdAt).getHours() === h).reduce((x, s) => x + s.total, 0),
    }))

    const bestDay = days.reduce((b, d) => (d.total > b.total ? d : b), days[0] ?? { label: '—', total: 0, full: '—' })
    const bestHour = hours.reduce((b, x) => (x.total > b.total ? x : b), hours[0] ?? { h: 0, total: 0 })

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
      hours,
      bestDay,
      bestHour,
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
  const dayTotal = stats.days.reduce((s, d) => s + d.total, 0)
  const avgDay = stats.days.length ? dayTotal / stats.days.length : 0
  const methodTotal = (Object.values(stats.byMethod) as number[]).reduce((a, b) => a + Math.max(0, b), 0)
  const catTotal = stats.byCat.reduce((s, [, v]) => s + Math.max(0, v), 0)
  const topTotal = stats.top.reduce((s, t) => s + Math.max(0, t.revenue), 0)
  const visibleHours = stats.hours.slice(6, 22)
  const maxHour = Math.max(1, ...visibleHours.map((x) => x.total))

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Reports"
        subtitle="Sales, profit, VAT and stock health"
        actions={
          <>
            <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <button key={r} onClick={() => setRange(r)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${range === r ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
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

      {/* ------------------------------------------------ KPI strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Net sales" value={money(stats.net, c)} sub={`${stats.count} transactions`} color={PALETTE[0]} icon={Banknote} />
        <Kpi label="Gross profit" value={money(stats.profit, c)} sub={`${stats.margin}% margin (ex VAT)`} color={PALETTE[1]} icon={TrendingUp} />
        <Kpi label="Average sale" value={money(stats.avg, c)} sub="per transaction" color={PALETTE[4]} icon={Receipt} />
        <Kpi label="VAT collected" value={money(stats.tax, c)} sub="for KRA returns" color="#1AA5A5" icon={Percent} />
        <Kpi label="Refunds" value={money(stats.refunds, c)} sub={stats.refunds > 0 ? 'issued in range' : 'none in range'} color={PALETTE[3]} icon={Undo2} />
      </div>

      {/* ---------------------------------------- Day chart + payment donut */}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Net sales by day</h2>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-[#1565C0] to-[#2480E8]" /> Daily total
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0 w-4 border-t-2 border-dashed border-slate-400" /> Average
              </span>
            </div>
          </div>

          {/* insight chips */}
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#1565C0]">
              Peak: {stats.bestDay.full} · {money(stats.bestDay.total, c)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              Avg/day {money(Math.round(avgDay), c)}
            </span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[#1F6B3C]">
              Busiest hour: {stats.bestHour.h}:00–{stats.bestHour.h + 1}:00
            </span>
          </div>

          <div className="relative h-52 pl-10">
            {/* gridlines + y labels */}
            {[1, 0.75, 0.5, 0.25, 0].map((f) => (
              <div key={f} className="absolute right-0 left-10 flex items-center" style={{ bottom: `${f * 100}%` }} aria-hidden>
                <span className="w-10 -translate-x-full pr-2 text-right text-[10px] text-slate-400">{f === 0 ? '0' : moneyShort(Math.round(maxDay * f))}</span>
                <div className="h-px flex-1 bg-slate-100" />
              </div>
            ))}
            {/* average line */}
            <div className="absolute right-0 left-10 z-10 border-t-2 border-dashed border-slate-400/70" style={{ bottom: `${pct(avgDay, maxDay)}%` }} aria-hidden />
            {/* bars */}
            <div className="relative flex h-full items-end gap-[3px]">
              {stats.days.map((d) => {
                const isPeak = d.label === stats.bestDay.label && d.total > 0
                return (
                  <div key={d.label} className="group relative flex h-full flex-1 flex-col justify-end">
                    <div
                      className={`rounded-t bg-gradient-to-t from-[#1565C0] to-[#3D92F0] transition group-hover:from-[#0F4F9A] group-hover:to-[#2480E8] ${isPeak ? 'ring-2 ring-[#FABF24] ring-offset-1' : ''}`}
                      style={{ height: `${pct(d.total, maxDay)}%`, minHeight: d.total > 0 ? 3 : 0 }}
                    />
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
                      {d.full}: <b>{money(d.total, c)}</b>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="mt-1 flex justify-between pl-10 text-[11px] text-slate-500">
            <span>{stats.days[0]?.label}</span>
            {stats.days.length > 2 && <span className="hidden sm:inline">{stats.days[Math.floor(stats.days.length / 2)]?.label}</span>}
            <span>{stats.days[stats.days.length - 1]?.label}</span>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Takings by payment method</h2>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Donut
              total={methodTotal}
              centerLabel="Total"
              segments={(Object.keys(stats.byMethod) as PaymentMethod[]).map((m) => ({
                label: METHOD_LABEL[m],
                value: Math.max(0, stats.byMethod[m]),
                color: METHOD_COLOR[m],
              }))}
            />
            <ul className="w-full flex-1 space-y-2.5">
              {(Object.keys(stats.byMethod) as PaymentMethod[]).map((m) => {
                const v = Math.max(0, stats.byMethod[m])
                return (
                  <li key={m}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 font-medium text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: METHOD_COLOR[m] }} />
                        {METHOD_LABEL[m]}
                      </span>
                      <span className="tabular-nums font-semibold">{money(v, c)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${pct(v, methodTotal)}%`, background: METHOD_COLOR[m] }} />
                      </div>
                      <span className="w-9 text-right text-[11px] tabular-nums text-slate-400">{Math.round(pct(v, methodTotal))}%</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      </div>

      {/* ---------------------------------------------- Hour heat + nothing else */}
      <section className="card mb-4 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Clock size={17} className="text-[#2480E8]" /> Sales by hour
          </h2>
          <span className="text-xs text-slate-500">When the till is busiest (6:00 – 22:00)</span>
        </div>
        {dayTotal <= 0 ? (
          <Empty>No sales in this range.</Empty>
        ) : (
          <div className="flex h-28 items-end gap-1.5">
            {visibleHours.map((x) => {
              const isPeak = x.h === stats.bestHour.h && x.total > 0
              return (
                <div key={x.h} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div
                    className={`rounded-t bg-gradient-to-t from-[#1AA5A5] to-[#3EC4C4] transition group-hover:from-[#147E7E] group-hover:to-[#1AA5A5] ${isPeak ? 'ring-2 ring-[#FABF24] ring-offset-1' : ''}`}
                    style={{ height: `${pct(x.total, maxHour)}%`, minHeight: x.total > 0 ? 3 : 0 }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
                    {x.h}:00–{x.h + 1}:00: <b>{money(x.total, c)}</b>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="mt-1 flex justify-between text-[11px] text-slate-400">
          {[6, 10, 14, 18, 21].map((h) => (
            <span key={h}>{h}:00</span>
          ))}
        </div>
      </section>

      {/* ------------------------- Top sellers / categories / reorder */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Trophy size={17} className="text-[#FABF24]" /> Top sellers
          </h2>
          {stats.top.length === 0 ? (
            <Empty>No sales yet.</Empty>
          ) : (
            <ol className="space-y-3 text-sm">
              {stats.top.map((t, i) => (
                <li key={t.name}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                          i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="truncate font-medium">{t.name}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">
                      {t.qty} sold · <b className="text-slate-900">{moneyShort(t.revenue)}</b>
                    </span>
                  </div>
                  <div className="mt-1 ml-8 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#FABF24] to-[#E23C37] transition-all" style={{ width: `${pct(t.revenue, topTotal)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Sales by category</h2>
          {stats.byCat.length === 0 ? (
            <Empty>No sales yet.</Empty>
          ) : (
            <div className="space-y-3">
              {stats.byCat.map(([name, v], i) => (
                <div key={name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                      {name}
                    </span>
                    <span className="tabular-nums">
                      <b>{moneyShort(v)}</b>
                      <span className="ml-1.5 text-[11px] text-slate-400">{Math.round(pct(v, catTotal))}%</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct(v, catTotal)}%`, background: PALETTE[i % PALETTE.length] }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Reorder now ({low.length})</h2>
          <div className="max-h-72 space-y-3 overflow-y-auto text-sm">
            {low.map((p) => {
              const ratio = pct(p.stock, Math.max(1, p.reorderLevel))
              return (
                <div key={p.id}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <Badge tone={p.stock <= 0 ? 'red' : 'amber'}>
                      {p.stock} / {p.reorderLevel}
                    </Badge>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${p.stock <= 0 ? 'bg-[#E23C37]' : 'bg-[#FABF24]'}`}
                      style={{ width: `${Math.max(p.stock > 0 ? 6 : 0, ratio)}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {low.length === 0 && <Empty>All parts above reorder level.</Empty>}
          </div>
        </section>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  color: string
  icon: typeof Banknote
}) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 truncate text-xl font-bold" style={{ color }}>
            {value}
          </div>
          {sub && <div className="mt-0.5 truncate text-xs text-slate-500">{sub}</div>}
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: `${color}1f`, color }}>
          <Icon size={18} />
        </span>
      </div>
    </div>
  )
}

function Donut({
  segments,
  total,
  centerLabel,
}: {
  segments: { label: string; value: number; color: string }[]
  total: number
  centerLabel: string
}) {
  const R = 54
  const C = 2 * Math.PI * R
  let offset = 0
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = pct(s.value, total) * (C / 100)
      const arc = { ...s, len, offset }
      offset += len
      return arc
    })

  return (
    <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0" role="img" aria-label="Payment method split">
      <circle cx="70" cy="70" r={R} fill="none" stroke="#eef2f4" strokeWidth="17" />
      {arcs.map((a) => (
        <circle
          key={a.label}
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke={a.color}
          strokeWidth="17"
          strokeDasharray={`${a.len} ${C - a.len}`}
          strokeDashoffset={-a.offset}
          transform="rotate(-90 70 70)"
        >
          <title>{`${a.label}: ${money(a.value)}`}</title>
        </circle>
      ))}
      <text x="70" y="66" textAnchor="middle" fontSize="15" fontWeight="800" fill="#0f172a">
        {moneyShort(total)}
      </text>
      <text x="70" y="82" textAnchor="middle" fontSize="10" fill="#64748b">
        {centerLabel}
      </text>
    </svg>
  )
}
