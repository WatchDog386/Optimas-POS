import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowRight, ArrowUpRight, Barcode, CheckCircle2, Circle, ShieldAlert, Sparkles, Trophy, Wallet, X } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { loadBarcodePrinterConfig, loadPrinterConfig } from '../lib/printer'
import { serverLink, type ServerLink } from '../lib/api'
import { money, moneyShort } from '../lib/money'
import type { LogEntry, Product, Sale, StockUnit } from '../db/types'

const DAY = 86_400_000

function startOfDay(t = Date.now()): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const netSales = (sales: Sale[]) => sales.filter((s) => s.status !== 'voided').reduce((sum, s) => sum + s.total, 0)

/** First-run checklist shown until the shop is ready to trade (or dismissed). */
export function SetupChecklist() {
  const settings = useSettings()
  const dismissed = useLiveQuery(() => db.kv.get('ui:setupChecklistDone'), [])
  const counts = useLiveQuery(
    async () => ({
      staff: await db.users.filter((u) => u.active && u.role !== 'owner').count(),
      products: await db.products.count(),
      sales: await db.sales.count(),
      backup: await db.logs.where('kind').equals('system').filter((l) => l.action === 'Backup downloaded').count(),
    }),
    [],
  )
  const [link, setLink] = useState<ServerLink | null>(null)
  useEffect(() => {
    void serverLink().then(setLink)
  }, [])
  if (!counts || dismissed?.value) return null

  const labelReady = loadBarcodePrinterConfig().mode !== 'browser'
  const receiptReady = loadPrinterConfig().mode !== 'browser'
  const steps: { done: boolean; title: string; detail: string; to: string }[] = [
    { done: !!settings.phone && !!settings.address, title: 'Shop details', detail: 'Phone, address and KRA PIN for receipts', to: '/settings' },
    {
      done: link === 'connected',
      title: 'Connect the shop server',
      detail: link === 'needs-setup' ? 'Settings → Security → enter the setup code' : 'Needed for STK Push, LAN printers and more tills',
      to: '/settings',
    },
    { done: receiptReady, title: 'Receipt printer', detail: 'Pair the 80 mm printer and test the cash drawer', to: '/settings' },
    { done: labelReady, title: 'Xprinter label printer', detail: 'Pick label size, pair, print a test label', to: '/settings' },
    { done: counts.staff > 0, title: 'Add your staff', detail: 'Cashiers and managers with their own PINs', to: '/staff' },
    { done: counts.products > 0, title: 'Add your first part', detail: 'Opening stock prints one serial label per unit', to: '/inventory?new=1' },
    { done: counts.sales > 0, title: 'Ring up a test sale', detail: 'Scan a label, take payment, print the receipt', to: '/sell' },
    { done: counts.backup > 0, title: 'Download a backup', detail: 'Do this daily — Settings → Backup', to: '/settings' },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white shadow-card">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-white">
            <Sparkles size={18} />
          </span>
          <div>
            <h2 className="text-base font-bold text-navy-900">Get ready to trade</h2>
            <p className="text-sm text-slate-600">
              {done} of {steps.length} done
            </p>
          </div>
        </div>
        <button
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700"
          title="Hide checklist"
          onClick={() => void db.kv.put({ key: 'ui:setupChecklistDone', value: true })}
        >
          <X size={16} />
        </button>
      </div>
      <div className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-brand-100">
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="grid gap-1 p-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => (
          <li key={s.title}>
            <Link to={s.to} className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-white ${s.done ? 'opacity-60' : ''}`}>
              {s.done ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={18} className="mt-0.5 shrink-0 text-slate-300" />}
              <span>
                <span className={`block text-sm font-semibold ${s.done ? 'text-slate-500 line-through' : 'text-navy-900'}`}>{s.title}</span>
                <span className="block text-xs text-slate-500">{s.detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Today vs yesterday at the same time — the first number an owner checks. */
export function TrendStrip() {
  const settings = useSettings()
  const today = startOfDay()
  const now = Date.now()
  const data = useLiveQuery(
    async () => {
      const sales = await db.sales.where('createdAt').aboveOrEqual(today - DAY).toArray()
      const yesterdaySoFar = sales.filter((s) => s.createdAt < today && s.createdAt <= now - DAY)
      const todays = sales.filter((s) => s.createdAt >= today)
      const units = await db.units.where('status').equals('in_stock').count()
      const owing = (await db.customers.filter((c) => c.balance > 0).toArray()).reduce((sum, c) => sum + c.balance, 0)
      const products = await db.products.filter((p) => p.trackStock && p.stock > 0).toArray()
      return {
        today: netSales(todays),
        yesterday: netSales(yesterdaySoFar),
        tickets: todays.filter((s) => s.total > 0 && s.status !== 'voided').length,
        units,
        owing,
        stockCost: products.reduce((sum, p) => sum + p.stock * p.cost, 0),
        stockRetail: products.reduce((sum, p) => sum + p.stock * p.price, 0),
      }
    },
    [today],
  )
  if (!data) return null
  const delta = data.yesterday > 0 ? Math.round(((data.today - data.yesterday) / data.yesterday) * 100) : null
  const items = [
    {
      label: 'Net sales today',
      value: money(data.today, settings.currency),
      note:
        delta === null ? (
          `${data.tickets} tickets`
        ) : (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta)}% vs this time yesterday
          </span>
        ),
    },
    { label: 'Stock value (cost)', value: money(data.stockCost, settings.currency), note: `${money(data.stockRetail, settings.currency)} at retail` },
    { label: 'Labelled units on shelf', value: data.units.toLocaleString('en-KE'), note: 'each with its own serial' },
    { label: 'Customers owe you', value: money(data.owing, settings.currency), note: <Link to="/customers" className="font-semibold text-brand-600">Collect →</Link> },
  ]
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl border border-hairline bg-white px-4 py-3 shadow-card">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{i.label}</div>
          <div className="mt-1 truncate text-lg font-extrabold tabular-nums text-navy-900 sm:text-xl">{i.value}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{i.note}</div>
        </div>
      ))}
    </div>
  )
}

function Panel({ title, icon: Icon, to, action, children }: { title: string; icon: typeof Trophy; to?: string; action?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy-900">
          <Icon size={16} className="text-brand-500" />
          {title}
        </h2>
        {to && (
          <Link to={to} className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
            {action ?? 'Open'} <ArrowRight size={13} />
          </Link>
        )}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  )
}

/** Owner insights: 7-day trend, best sellers, stock health, loss prevention and staff. */
export function AdminInsights() {
  const settings = useSettings()
  const weekStart = startOfDay(Date.now() - 6 * DAY)
  const today = startOfDay()

  const sales = useLiveQuery(() => db.sales.where('createdAt').aboveOrEqual(startOfDay(Date.now() - 59 * DAY)).toArray(), [], [] as Sale[])
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[])
  const units = useLiveQuery(() => db.units.where('status').equals('in_stock').toArray(), [], [] as StockUnit[])
  const users = useLiveQuery(() => db.users.toArray(), [], [])
  const todayLogs = useLiveQuery(() => db.logs.where('at').aboveOrEqual(today).toArray(), [today], [] as LogEntry[])

  const days = useMemo(() => {
    const out: { label: string; total: number; start: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const start = startOfDay(Date.now() - i * DAY)
      const total = netSales(sales.filter((s) => s.createdAt >= start && s.createdAt < start + DAY))
      out.push({ label: new Date(start).toLocaleDateString('en-KE', { weekday: 'short' }), total, start })
    }
    return out
  }, [sales])
  const maxDay = Math.max(1, ...days.map((d) => d.total))

  const top = useMemo(() => {
    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>()
    for (const s of sales) {
      if (s.createdAt < weekStart || s.status === 'voided') continue
      for (const l of s.lines) {
        const key = String(l.productId ?? l.name)
        const row = byProduct.get(key) ?? { name: l.name, qty: 0, revenue: 0 }
        row.qty += l.qty
        row.revenue += l.qty * l.unitPrice - l.discount
        byProduct.set(key, row)
      }
    }
    return [...byProduct.values()].filter((r) => r.qty > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
  }, [sales, weekStart])

  const stock = useMemo(() => {
    const soldRecently = new Set<number>()
    for (const s of sales) for (const l of s.lines) if (l.productId && l.qty > 0) soldRecently.add(l.productId)
    const labelled = new Map<number, number>()
    for (const u of units) labelled.set(u.productId, (labelled.get(u.productId) ?? 0) + 1)
    const tracked = products.filter((p) => p.active && p.trackStock)
    const dead = tracked.filter((p) => p.stock > 0 && !soldRecently.has(p.id!) && p.createdAt < Date.now() - 60 * DAY)
    return {
      out: tracked.filter((p) => p.stock <= 0).length,
      low: tracked.filter((p) => p.stock > 0 && p.stock <= p.reorderLevel).length,
      dead: dead.length,
      deadValue: dead.reduce((sum, p) => sum + p.stock * p.cost, 0),
      unlabelled: tracked.reduce((sum, p) => sum + Math.max(0, p.stock - (labelled.get(p.id!) ?? 0)), 0),
      noPrice: products.filter((p) => p.active && p.trackStock && p.price <= 0).length,
    }
  }, [products, sales, units])

  const watch = useMemo(() => {
    const todays = sales.filter((s) => s.createdAt >= today)
    return {
      refunds: todays.filter((s) => s.refundOf).reduce((sum, s) => sum - s.total, 0),
      refundCount: todays.filter((s) => s.refundOf).length,
      discounts: todays.filter((s) => !s.refundOf).reduce((sum, s) => sum + s.discount + s.lines.reduce((n, l) => n + l.discount, 0), 0),
      voids: todayLogs.filter((l) => l.action === 'Sale voided before payment').length,
      wrongPins: todayLogs.filter((l) => l.action === 'Wrong PIN').length,
    }
  }, [sales, todayLogs, today])

  const staff = useMemo(() => {
    const byUser = new Map<number, { total: number; count: number }>()
    for (const s of sales) {
      if (s.createdAt < today || s.status === 'voided') continue
      const row = byUser.get(s.userId) ?? { total: 0, count: 0 }
      row.total += s.total
      if (s.total > 0) row.count++
      byUser.set(s.userId, row)
    }
    return [...byUser.entries()]
      .map(([id, r]) => ({ name: users.find((u) => u.id === id)?.name ?? `User ${id}`, ...r }))
      .sort((a, b) => b.total - a.total)
  }, [sales, users, today])

  const weekTotal = days.reduce((s, d) => s + d.total, 0)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Last 7 days" icon={Wallet} to="/reports" action="Reports">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-extrabold tabular-nums text-navy-900">{money(weekTotal, settings.currency)}</span>
          <span className="text-xs text-slate-500">avg {money(Math.round(weekTotal / 7), settings.currency)} / day</span>
        </div>
        <div className="mt-4 flex h-32 items-end gap-2" role="img" aria-label="Net sales per day for the last 7 days">
          {days.map((d) => (
            <div key={d.start} className="group flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-semibold tabular-nums text-slate-500 opacity-0 transition group-hover:opacity-100">{moneyShort(d.total)}</span>
              <div
                className={`w-full rounded-t-md transition ${d.start === today ? 'bg-brand-500' : 'bg-brand-200 group-hover:bg-brand-300'}`}
                style={{ height: `${Math.max(3, (d.total / maxDay) * 100)}%` }}
                title={`${d.label}: ${money(d.total, settings.currency)}`}
              />
              <span className={`text-[11px] ${d.start === today ? 'font-bold text-navy-900' : 'text-slate-500'}`}>{d.label}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Best sellers this week" icon={Trophy} to="/reports" action="Reports">
        {top.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No sales this week yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {top.map((r, i) => (
              <li key={r.name + i} className="flex items-center gap-3">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${i === 0 ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{r.name}</span>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${(r.revenue / top[0].revenue) * 100}%` }} />
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <b className="block tabular-nums text-slate-800">{money(r.revenue, '')}</b>
                  <span className="text-slate-500">{r.qty} sold</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Stock health" icon={Barcode} to="/inventory" action="Inventory">
        <div className="grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-3">
          {[
            { label: 'Out of stock', value: stock.out, tone: stock.out ? 'text-red-600' : 'text-slate-800', to: '/inventory?view=lowstock' },
            { label: 'Low stock', value: stock.low, tone: stock.low ? 'text-amber-600' : 'text-slate-800', to: '/inventory?view=lowstock' },
            { label: 'Need labels', value: stock.unlabelled, tone: stock.unlabelled ? 'text-amber-600' : 'text-slate-800', to: '/inventory' },
            { label: 'No selling price', value: stock.noPrice, tone: stock.noPrice ? 'text-red-600' : 'text-slate-800', to: '/inventory' },
            { label: 'Dead stock (60 d)', value: stock.dead, tone: stock.dead ? 'text-amber-600' : 'text-slate-800', to: '/reports' },
            { label: 'Dead stock value', value: money(stock.deadValue, ''), tone: 'text-slate-800', to: '/reports' },
          ].map((t) => (
            <Link key={t.label} to={t.to} className="rounded-lg border border-hairline px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/40">
              <div className={`text-lg font-extrabold tabular-nums ${t.tone}`}>{t.value}</div>
              <div className="text-[11px] text-slate-500">{t.label}</div>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel title="Loss prevention · today" icon={ShieldAlert} to="/logs" action="Activity log">
        <ul className="divide-y divide-hairline text-sm">
          {[
            ['Refunds', watch.refundCount ? `${watch.refundCount} · ${money(watch.refunds, settings.currency)}` : 'None', watch.refundCount > 0],
            ['Discounts given', watch.discounts ? money(watch.discounts, settings.currency) : 'None', watch.discounts > 0],
            ['Sales voided before payment', String(watch.voids), watch.voids > 0],
            ['Wrong PIN attempts', String(watch.wrongPins), watch.wrongPins >= 3],
          ].map(([label, value, flag]) => (
            <li key={label as string} className="flex items-center justify-between py-2">
              <span className="text-slate-600">{label}</span>
              <span className={`font-semibold tabular-nums ${flag ? 'text-amber-700' : 'text-slate-800'}`}>{value}</span>
            </li>
          ))}
        </ul>
        {staff.length > 0 && (
          <div className="mt-3 border-t border-hairline pt-3">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Takings by staff</div>
            {staff.map((s) => (
              <div key={s.name} className="flex justify-between py-0.5 text-sm">
                <span className="text-slate-700">{s.name}</span>
                <span className="tabular-nums text-slate-600">
                  {s.count} · <b className="text-slate-800">{money(s.total, '')}</b>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
