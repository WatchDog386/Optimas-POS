// Store Executive Dashboard — the owner/manager home screen, built from the
// Stitch design export (code.html / screen.png) on live till data.

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  CircleCheck,
  FileSpreadsheet,
  Lock,
  PackagePlus,
  Plus,
  Printer,
  ScanSearch,
  TriangleAlert,
  Truck,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { summarizeShift } from '../db/shifts'
import { createPurchaseOrder, draftReorder } from '../db/purchasing'
import type { Category, Customer, PaymentMethod, Product, Sale, Supplier, User } from '../db/types'
import { useSession } from '../session'
import { money, moneyShort } from '../lib/money'
import { download, toCsv } from '../lib/csv'
import { useSyncStatus } from '../lib/sync'
import { currentTill } from '../db/till'
import { errorText, useToast } from '../components/ui'
import ReceiptModal from '../components/ReceiptModal'
import { LossPreventionPanel, SetupChecklist } from '../components/AdminInsights'

const DAY = 86_400_000
const TENDER: Record<PaymentMethod, { label: string; color: string }> = {
  mpesa: { label: 'M-Pesa', color: '#009f54' },
  cash: { label: 'Cash', color: '#0051d5' },
  card: { label: 'Card', color: '#75777d' },
  account: { label: 'Credit', color: '#c58a00' },
}

function startOfDay(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const valid = (s: Sale) => s.status !== 'voided'
const net = (sales: Sale[]) => sales.filter(valid).reduce((sum, s) => sum + s.total, 0)
const cost = (sales: Sale[]) => sales.filter(valid).reduce((sum, s) => sum + s.lines.reduce((n, l) => n + l.qty * l.unitCost, 0), 0)

function tenderOf(s: Sale): string {
  const methods = [...new Set(s.payments.map((p) => p.method))]
  if (methods.length > 1) return 'Split'
  return methods[0] ? TENDER[methods[0]].label : '—'
}

export default function ExecutiveDashboardPage() {
  const settings = useSettings()
  const toast = useToast()
  const navigate = useNavigate()
  const { user, shift, can } = useSession()
  const sync = useSyncStatus()
  const [day, setDay] = useState<'today' | 'yesterday'>('today')
  const [cashier, setCashier] = useState<number | 'all'>('all')
  const [receipt, setReceipt] = useState<Sale | null>(null)

  const todayStart = startOfDay(Date.now())
  const dayStart = day === 'today' ? todayStart : todayStart - DAY
  const dayEnd = dayStart + DAY

  // Last 8 days covers the chosen day, yesterday-at-this-time and the 7-day hourly average.
  const sales = useLiveQuery(() => db.sales.where('createdAt').aboveOrEqual(todayStart - 8 * DAY).toArray(), [todayStart], [] as Sale[])
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [] as Category[])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])
  const customers = useLiveQuery(() => db.customers.toArray(), [], [] as Customer[])
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const shiftSales = useLiveQuery(() => (shift?.id ? db.sales.where('shiftId').equals(shift.id).toArray() : Promise.resolve([] as Sale[])), [shift?.id], [] as Sale[])

  const userName = (id: number) => users.find((u) => u.id === id)?.name ?? `User ${id}`
  const byCashier = (s: Sale) => cashier === 'all' || s.userId === cashier
  const daySales = useMemo(() => sales.filter((s) => s.createdAt >= dayStart && s.createdAt < dayEnd && byCashier(s)), [sales, dayStart, dayEnd, cashier])

  const kpi = useMemo(() => {
    const revenue = net(daySales)
    const tickets = daySales.filter((s) => valid(s) && s.total > 0).length
    const profit = revenue - cost(daySales)
    // Compare with the previous day up to the same time of day.
    const offset = Math.min(Date.now(), dayEnd) - dayStart
    const prev = net(sales.filter((s) => s.createdAt >= dayStart - DAY && s.createdAt < dayStart - DAY + offset && byCashier(s)))
    const week = sales.filter((s) => s.createdAt >= dayStart - 7 * DAY && s.createdAt < dayStart && byCashier(s))
    const weekAvg = net(week) / 7
    const tender: Record<PaymentMethod, number> = { cash: 0, mpesa: 0, card: 0, account: 0 }
    for (const s of daySales.filter(valid)) {
      for (const p of s.payments) tender[p.method] += p.amount
      tender.cash -= s.change
    }
    return {
      revenue,
      tickets,
      avg: tickets ? Math.round(revenue / tickets) : 0,
      profit,
      margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
      delta: prev > 0 ? Math.round(((revenue - prev) / prev) * 1000) / 10 : null,
      weekAvg,
      tender,
      refunds: daySales.filter((s) => s.refundOf).reduce((sum, s) => sum - s.total, 0),
    }
  }, [daySales, sales, dayStart, dayEnd, cashier])

  const stock = useMemo(() => {
    const tracked = products.filter((p) => p.active && p.trackStock)
    const onHand = tracked.filter((p) => p.stock > 0)
    const zero = tracked.filter((p) => p.stock <= 0)
    const low = tracked.filter((p) => p.stock <= p.reorderLevel).sort((a, b) => a.stock / Math.max(1, a.reorderLevel) - b.stock / Math.max(1, b.reorderLevel))
    const reorderQty = (p: Product) => Math.max(1, p.reorderLevel * 2 - p.stock)
    return {
      value: onHand.reduce((s, p) => s + p.stock * p.cost, 0),
      retail: onHand.reduce((s, p) => s + p.stock * p.price, 0),
      lines: onHand.length,
      bins: new Set(onHand.map((p) => p.location).filter(Boolean)).size,
      zero: zero.length,
      low,
      reorderQty,
      restockCost: low.reduce((s, p) => s + reorderQty(p) * p.cost, 0),
    }
  }, [products])

  const credit = useMemo(() => {
    const owing = customers.filter((c) => c.balance > 0)
    return {
      total: owing.reduce((s, c) => s + c.balance, 0),
      count: owing.length,
      overLimit: owing.filter((c) => c.creditLimit > 0 && c.balance > c.creditLimit).length,
      top: [...owing].sort((a, b) => b.balance - a.balance)[0],
    }
  }, [customers])

  const drawer = shift ? summarizeShift(shift, shiftSales) : null

  // Hourly revenue by tender, with the 7-day average for each hour.
  const hourly = useMemo(() => {
    const buckets = new Map<number, Record<'mpesa' | 'cash' | 'other', number>>()
    const avg = new Map<number, number>()
    for (const s of daySales.filter(valid)) {
      const h = new Date(s.createdAt).getHours()
      const b = buckets.get(h) ?? { mpesa: 0, cash: 0, other: 0 }
      for (const p of s.payments) {
        const amt = p.method === 'cash' ? p.amount - s.change : p.amount
        if (p.method === 'mpesa') b.mpesa += amt
        else if (p.method === 'cash') b.cash += amt
        else b.other += amt
      }
      buckets.set(h, b)
    }
    for (const s of sales.filter((x) => valid(x) && x.createdAt >= dayStart - 7 * DAY && x.createdAt < dayStart && byCashier(x))) {
      const h = new Date(s.createdAt).getHours()
      avg.set(h, (avg.get(h) ?? 0) + s.total / 7)
    }
    const hours = [...buckets.keys(), ...avg.keys()]
    const from = Math.min(8, ...hours)
    const to = Math.max(18, ...hours)
    const rows = []
    for (let h = from; h <= to; h++) {
      const b = buckets.get(h) ?? { mpesa: 0, cash: 0, other: 0 }
      rows.push({ h, ...b, total: Math.max(0, b.mpesa + b.cash + b.other), avg: avg.get(h) ?? 0 })
    }
    const max = Math.max(1, ...rows.map((r) => Math.max(r.total, r.avg)))
    return { rows, max }
  }, [daySales, sales, dayStart, cashier])

  const tenderMix = useMemo(() => {
    const t = kpi.tender
    const total = Math.max(1, t.mpesa + t.cash + t.card + t.account)
    return { mpesa: Math.round((t.mpesa / total) * 100), cash: Math.round((t.cash / total) * 100), other: Math.round(((t.card + t.account) / total) * 100) }
  }, [kpi])

  const perCashier = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of daySales) if (valid(s) && s.total > 0) m.set(s.userId, (m.get(s.userId) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [daySales])

  const categoryMovement = useMemo(() => {
    const productById = new Map(products.map((p) => [p.id!, p]))
    const byCat = new Map<string, { name: string; revenue: number; parts: Map<string, number> }>()
    const units = new Map<string, number>()
    for (const s of daySales.filter(valid)) {
      for (const l of s.lines) {
        const p = l.productId ? productById.get(l.productId) : undefined
        const cat = categories.find((c) => c.id === p?.categoryId)?.name ?? (l.productId ? 'Uncategorised' : 'Labour & custom')
        const row = byCat.get(cat) ?? { name: cat, revenue: 0, parts: new Map() }
        row.revenue += l.qty * l.unitPrice - l.discount
        row.parts.set(l.name, (row.parts.get(l.name) ?? 0) + l.qty)
        byCat.set(cat, row)
        units.set(l.name, (units.get(l.name) ?? 0) + l.qty)
      }
    }
    const rows = [...byCat.values()].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue)
    const total = Math.max(1, rows.reduce((s, r) => s + r.revenue, 0))
    const top = [...units.entries()].sort((a, b) => b[1] - a[1])[0]
    return { rows: rows.slice(0, 6), total, top }
  }, [daySales, products, categories])

  const recent = useMemo(() => [...daySales].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8), [daySales])
  const cashiers = useMemo(() => users.filter((u) => u.active), [users])

  const quickPo = async (p: Product) => {
    try {
      const po = await createPurchaseOrder([{ productId: p.id!, qty: stock.reorderQty(p), unitCost: p.cost, received: 0 }], p.supplierId, `Reorder from dashboard — ${p.name}`)
      toast(`Draft ${po.poNo} created for ${p.name}`)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const bulkPo = async () => {
    const po = await draftReorder()
    if (!po) return toast('Nothing is below its reorder level')
    toast(`Draft ${po.poNo} created with ${po.lines.length} parts`)
    navigate('/purchasing')
  }

  const exportDay = () => {
    const rows = [...daySales]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => [
        s.receiptNo,
        new Date(s.createdAt).toLocaleString('en-KE'),
        userName(s.userId),
        customers.find((c) => c.id === s.customerId)?.name ?? 'Walk-in',
        s.lines.reduce((n, l) => n + l.qty, 0),
        s.total / 100,
        s.payments.map((p) => `${TENDER[p.method].label} ${p.amount / 100}${p.reference ? ` (${p.reference})` : ''}`).join(' + '),
        s.status,
      ])
    download(
      `sales-${new Date(dayStart).toISOString().slice(0, 10)}.csv`,
      toCsv([['receipt', 'time', 'cashier', 'customer', 'items', 'total', 'tenders', 'status'], ...rows]),
    )
  }

  const synced = sync.state === 'idle' && sync.pending === 0
  const dateLabel = new Date(dayStart).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <SetupChecklist />

      {/* Header */}
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-white p-5 shadow-card">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-adm-primary sm:text-[28px]">Store Executive Dashboard</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${synced ? 'bg-adm-green-soft text-adm-green' : 'bg-amber-100 text-amber-800'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${synced ? 'bg-adm-green' : 'animate-pulse bg-amber-500'}`} />
              {synced ? 'Hub live sync' : sync.pending ? `${sync.pending} waiting to sync` : 'Sync paused'}
            </span>
          </div>
          <p className="mt-1 text-sm text-adm-muted">
            Sales, stock movement and cash across {settings.shopName}
            {settings.address ? ` · ${settings.address}` : ''} · Till #{currentTill()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-adm-high bg-adm-low px-3 text-sm">
            <CalendarDays size={15} className="text-adm-muted" />
            <select value={day} onChange={(e) => setDay(e.target.value as 'today' | 'yesterday')} className="bg-transparent font-semibold outline-none">
              <option value="today">Today: {new Date(todayStart).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}</option>
              <option value="yesterday">Yesterday</option>
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-adm-high bg-adm-low px-3 text-sm">
            <Users size={15} className="text-adm-muted" />
            <select value={cashier} onChange={(e) => setCashier(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="bg-transparent font-semibold outline-none">
              <option value="all">All staff ({cashiers.length})</option>
              {cashiers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={exportDay} className="flex h-9 items-center gap-1.5 rounded-lg border border-adm-high px-3 text-sm font-semibold text-adm-muted hover:bg-adm-low">
            <FileSpreadsheet size={15} /> Export CSV
          </button>
          {can('purchasing') && (
            <Link to="/purchasing" className="flex h-9 items-center gap-1.5 rounded-lg border border-adm-high px-3 text-sm font-semibold text-adm-blue hover:bg-adm-blue-soft">
              <Truck size={15} /> Stock inward
            </Link>
          )}
          <Link to="/shift" className="flex h-9 items-center gap-1.5 rounded-lg border border-adm-high px-3 text-sm font-semibold text-adm-blue hover:bg-adm-blue-soft">
            <Wallet size={15} /> Record expense
          </Link>
          {can('inventory') && (
            <Link to="/inventory?new=1" className="flex h-9 items-center gap-1.5 rounded-lg bg-adm-blue px-3 text-sm font-bold text-white hover:brightness-110">
              <Plus size={15} /> Add part (F3)
            </Link>
          )}
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label={`Gross sales (${day})`}
          badge={
            kpi.delta === null ? undefined : (
              <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${kpi.delta >= 0 ? 'bg-adm-green-soft text-adm-green' : 'bg-adm-red-soft text-adm-red'}`}>
                {kpi.delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {kpi.delta >= 0 ? '+' : ''}
                {kpi.delta}%
              </span>
            )
          }
          value={money(kpi.revenue, settings.currency)}
          sub={`${kpi.tickets} ticket${kpi.tickets === 1 ? '' : 's'} · Avg ${money(kpi.avg, settings.currency)}`}
          progress={kpi.weekAvg > 0 ? kpi.revenue / kpi.weekAvg : undefined}
          progressColor="bg-adm-blue"
          foot={kpi.weekAvg > 0 ? `7-day average ${money(Math.round(kpi.weekAvg), settings.currency)}` : 'No earlier sales to compare yet'}
        />
        <Kpi
          label="Est. gross profit"
          badge={<span className="rounded bg-adm-highest px-1.5 py-0.5 text-[11px] font-bold text-adm-ink">{kpi.margin}% margin</span>}
          value={money(kpi.profit, settings.currency)}
          sub={kpi.refunds ? `${money(kpi.refunds, settings.currency)} refunded` : 'No refunds'}
          progress={kpi.revenue > 0 ? kpi.margin / 40 : 0}
          progressColor="bg-adm-green"
          foot="After cost of parts sold · target margin 40%"
        />
        <Kpi
          label="Cash & till balance"
          badge={
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${synced ? 'bg-adm-green-soft text-adm-green' : 'bg-amber-100 text-amber-800'}`}>
              {synced ? <CircleCheck size={12} /> : null}
              {synced ? '100% synced' : sync.pending ? `${sync.pending} to sync` : 'Offline'}
            </span>
          }
          value={drawer ? money(drawer.expectedCash, settings.currency) : 'No shift open'}
          sub={`Cash ${money(kpi.tender.cash, '')} · M-Pesa ${money(kpi.tender.mpesa, '')}`}
          foot={
            <span className="flex w-full justify-between">
              <span>{drawer ? `Expected in drawer · float ${money(shift!.openingFloat, '')}` : `Till #${currentTill()}`}</span>
              <Link to="/shift" className="font-semibold text-adm-blue">
                {drawer ? 'Verify' : 'Open shift'} →
              </Link>
            </span>
          }
        />
        <Kpi
          label="Total stock value"
          icon={<Boxes size={16} className="text-adm-muted" />}
          value={`${settings.currency} ${moneyShort(stock.value)}`}
          sub={`${stock.lines.toLocaleString('en-KE')} SKU line${stock.lines === 1 ? '' : 's'}${stock.bins ? ` in ${stock.bins} bin${stock.bins === 1 ? '' : 's'}` : ''}`}
          foot={
            <span className="flex w-full justify-between">
              <span>At cost</span>
              <span>Retail {money(stock.retail, '')}</span>
            </span>
          }
        />
        <Kpi
          label="Customer credit"
          badge={credit.overLimit ? <span className="rounded bg-adm-red-soft px-1.5 py-0.5 text-[11px] font-bold text-adm-red">{credit.overLimit} over limit</span> : undefined}
          value={<span className={credit.total ? 'text-adm-red' : ''}>{money(credit.total, settings.currency)}</span>}
          sub={credit.top ? `Largest: ${credit.top.name} ${money(credit.top.balance, '')}` : 'Nobody owes the shop'}
          foot={
            <span className="flex w-full justify-between">
              <span>
                {credit.count} customer{credit.count === 1 ? '' : 's'} owing
              </span>
              <Link to="/customers" className="font-semibold text-adm-blue">
                Review ledgers →
              </Link>
            </span>
          }
        />
        <Kpi
          label="Stock attention"
          badge={stock.low.length ? <span className="grid h-6 min-w-6 place-items-center rounded-full bg-adm-red px-1.5 text-[11px] font-bold text-white">{stock.low.length}</span> : undefined}
          value={`${stock.low.length} SKU${stock.low.length === 1 ? '' : 's'}`}
          sub={`${stock.zero} zero stock · ${stock.low.length - stock.zero} at reorder level`}
          foot={
            <span className="flex w-full justify-between">
              <span className="text-adm-red">Est. {money(stock.restockCost, settings.currency)} to restock</span>
              {can('purchasing') && (
                <button onClick={() => void bulkPo()} className="font-semibold text-adm-blue">
                  Auto PO →
                </button>
              )}
            </span>
          }
        />
      </section>

      {/* Charts */}
      <section className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="rounded-xl bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-adm-primary">Hourly revenue & cashier velocity</h2>
              <p className="text-sm text-adm-muted">{day === 'today' ? "Today's" : "Yesterday's"} takings per hour against the 7-day average</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
              <Legend color={TENDER.mpesa.color} label={`M-Pesa (${tenderMix.mpesa}%)`} />
              <Legend color={TENDER.cash.color} label={`Cash (${tenderMix.cash}%)`} />
              <Legend color="#9aa0aa" label={`Card / credit (${tenderMix.other}%)`} />
            </div>
          </div>
          <div className="mt-5 flex h-56 items-end gap-1.5 sm:gap-2.5" role="img" aria-label="Revenue per hour">
            {hourly.rows.map((r) => {
              const isNow = day === 'today' && r.h === new Date().getHours()
              const pct = (v: number) => `${(v / hourly.max) * 100}%`
              return (
                <div key={r.h} className="group relative flex h-full flex-1 flex-col justify-end">
                  {r.avg > 0 && <div className="absolute inset-x-0 z-10 border-t-2 border-dashed border-adm-faint/60" style={{ bottom: pct(r.avg) }} title={`7-day average ${money(Math.round(r.avg), settings.currency)}`} />}
                  <div className="flex w-full flex-col justify-end overflow-hidden rounded-t" style={{ height: pct(r.total) }} title={`${String(r.h).padStart(2, '0')}:00 — ${money(r.total, settings.currency)}`}>
                    <div style={{ height: r.total ? `${(r.other / r.total) * 100}%` : 0, background: '#9aa0aa' }} />
                    <div style={{ height: r.total ? `${(r.cash / r.total) * 100}%` : 0, background: TENDER.cash.color }} />
                    <div style={{ height: r.total ? `${(r.mpesa / r.total) * 100}%` : 0, background: TENDER.mpesa.color }} />
                  </div>
                  {r.total === 0 && <div className="h-1 rounded bg-adm-low" />}
                  <span className={`mt-1.5 text-center text-[10px] tabular-nums ${isNow ? 'font-bold text-adm-blue' : 'text-adm-muted'}`}>
                    {String(r.h).padStart(2, '0')}
                    <span className="hidden sm:inline">:00</span>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-adm-low pt-3 text-xs text-adm-muted">
            {perCashier.length === 0 ? (
              <span>No sales recorded {day === 'today' ? 'yet today' : 'yesterday'}.</span>
            ) : (
              perCashier.map(([id, n]) => (
                <span key={id}>
                  <b className="text-adm-ink">{userName(id)}</b>: {n} sale{n === 1 ? '' : 's'}
                </span>
              ))
            )}
            {kpi.tickets > 0 && (
              <span className="flex items-center gap-1 font-semibold text-adm-green">
                <Zap size={12} /> {(daySales.filter((s) => valid(s) && s.total > 0).reduce((n, s) => n + s.lines.reduce((q, l) => q + l.qty, 0), 0) / kpi.tickets).toFixed(1)} items per ticket
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-adm-primary">Category movement</h2>
              <p className="text-sm text-adm-muted">Sales ranked by part category</p>
            </div>
            {can('reports') && (
              <Link to="/reports" className="text-xs font-semibold text-adm-blue">
                Full report →
              </Link>
            )}
          </div>
          {categoryMovement.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-adm-muted">No category sales {day === 'today' ? 'yet today' : 'yesterday'}.</p>
          ) : (
            <ul className="mt-4 space-y-3.5">
              {categoryMovement.rows.map((r, i) => {
                const share = Math.round((r.revenue / categoryMovement.total) * 100)
                const parts = [...r.parts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n)
                return (
                  <li key={r.name}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 font-semibold">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'bg-adm-blue' : 'bg-adm-faint'}`} />
                        <span className="truncate">{r.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <b>{money(r.revenue, settings.currency)}</b> <span className="text-xs text-adm-muted">{share}%</span>
                      </span>
                    </div>
                    <p className="ml-4 truncate text-xs text-adm-muted">{parts.join(', ')}</p>
                    <div className="ml-4 mt-1 h-1.5 overflow-hidden rounded-full bg-adm-low">
                      <div className="h-full rounded-full bg-adm-blue" style={{ width: `${share}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {categoryMovement.top && (
            <div className="mt-4 flex items-center justify-between rounded-lg bg-adm-low px-3 py-2.5 text-sm">
              <span className="min-w-0 truncate">
                Top performer: <b>{categoryMovement.top[0]}</b>
              </span>
              <span className="shrink-0 font-bold">{categoryMovement.top[1]} units</span>
            </div>
          )}
        </div>
      </section>

      {/* Tables */}
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="flex flex-col rounded-xl bg-white shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-adm-primary">
                <TriangleAlert size={18} className="text-adm-red" /> Critical low-stock & reorder alerts
              </h2>
              <p className="text-sm text-adm-muted">Parts at or below their reorder level</p>
            </div>
            {can('purchasing') && stock.low.length > 0 && (
              <button onClick={() => void bulkPo()} className="flex items-center gap-1.5 rounded-lg border border-adm-high px-3 py-1.5 text-xs font-semibold hover:bg-adm-low">
                <PackagePlus size={14} /> Create bulk PO
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-adm-low text-left text-[10px] font-bold uppercase tracking-wider text-adm-muted">
                <tr>
                  <th className="px-4 py-2.5">Part / OEM</th>
                  <th className="px-3 py-2.5 text-center">Stock / min</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5 text-right">Restock cost</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-adm-low">
                {stock.low.slice(0, 6).map((p) => {
                  const sup = suppliers.find((s) => s.id === p.supplierId)
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs text-adm-muted">
                          {p.partNumber ? `OEM ${p.partNumber}` : p.sku}
                          {p.fitment.length ? ` · Fits ${p.fitment.join(', ')}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-block rounded px-2 py-1 text-xs font-bold text-white ${p.stock <= 0 ? 'bg-adm-red' : 'bg-amber-500'}`}>
                          {p.stock} / {p.reorderLevel}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-adm-ink">{sup?.name ?? '—'}</div>
                        {sup?.phone && <div className="text-adm-muted">{sup.phone}</div>}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(stock.reorderQty(p) * p.cost, '')}</td>
                      <td className="px-4 py-3 text-right">
                        {can('purchasing') && (
                          <button onClick={() => void quickPo(p)} className="rounded bg-adm-blue px-2.5 py-1 text-xs font-bold text-white hover:brightness-110">
                            + PO
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {stock.low.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-adm-muted">
                      Every tracked part is above its reorder level.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-adm-low px-5 py-3 text-xs text-adm-muted">
            <span>
              Showing {Math.min(6, stock.low.length)} of {stock.low.length} alert lines
            </span>
            <Link to="/inventory?view=lowstock" className="flex items-center gap-1 font-semibold text-adm-blue">
              View all low-stock parts <ArrowRight size={13} />
            </Link>
          </div>
        </div>

        <div className="flex flex-col rounded-xl bg-white shadow-card">
          <div className="flex items-start justify-between gap-3 p-5 pb-3">
            <div>
              <h2 className="text-lg font-bold text-adm-primary">Live counter transactions</h2>
              <p className="text-sm text-adm-muted">Latest receipts from every till</p>
            </div>
            <Link to="/sales" className="rounded-lg border border-adm-high px-3 py-1.5 text-xs font-semibold hover:bg-adm-low">
              All invoices
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-adm-low text-left text-[10px] font-bold uppercase tracking-wider text-adm-muted">
                <tr>
                  <th className="px-4 py-2.5">Receipt · time</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5 text-center">Items</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5 text-center">Tender</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-adm-low">
                {recent.map((s) => {
                  const tender = tenderOf(s)
                  const tone = tender === 'M-Pesa' ? 'bg-adm-green-soft text-adm-green' : tender === 'Cash' ? 'bg-adm-blue-soft text-adm-blue' : 'bg-adm-highest text-adm-ink'
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{s.receiptNo}</div>
                        <div className="text-xs text-adm-muted">
                          {new Date(s.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })} · {userName(s.userId)}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs">{customers.find((c) => c.id === s.customerId)?.name ?? 'Walk-in'}</td>
                      <td className="px-3 py-3 text-center tabular-nums">{s.lines.reduce((n, l) => n + Math.abs(l.qty), 0)}</td>
                      <td className={`px-3 py-3 text-right font-semibold tabular-nums ${s.total < 0 ? 'text-adm-red' : ''}`}>{money(s.total, '')}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${tone}`}>{s.refundOf ? 'Refund' : tender}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setReceipt(s)} className="rounded p-1.5 text-adm-muted hover:bg-adm-low hover:text-adm-ink" title="View / reprint receipt">
                          <Printer size={15} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-adm-muted">
                      No receipts {day === 'today' ? 'yet today' : 'yesterday'}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-adm-low px-5 py-3 text-xs text-adm-muted">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${synced ? 'bg-adm-green' : 'bg-amber-500'}`} />
              {daySales.length} receipt{daySales.length === 1 ? '' : 's'} logged
            </span>
            <Link to="/sell" className="flex items-center gap-1 font-semibold text-adm-blue">
              Open POS register <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </section>

      <LossPreventionPanel />

      {/* Register actions */}
      <section className="rounded-xl bg-white p-4 shadow-card">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-adm-primary">
          <Zap size={16} className="text-adm-blue" /> Register actions
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionLink to="/shift" icon={Printer}>
            End of day till count (Z-report)
          </ActionLink>
          <ActionLink to="/shift" icon={Lock}>
            {shift ? 'Cash in / out' : 'Open shift cash drawer'}
          </ActionLink>
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            className="flex items-center gap-2 rounded-lg border border-adm-high px-3.5 py-2.5 text-sm font-semibold hover:bg-adm-low"
          >
            <ScanSearch size={16} className="text-adm-muted" /> Price lookup (Ctrl+K)
          </button>
          <ActionLink to="/customers" icon={Users}>
            Customer statements
          </ActionLink>
        </div>
        <p className="mt-3 text-xs text-adm-muted">
          Signed in as {user?.name} · {dateLabel}
        </p>
      </section>

      {receipt && <ReceiptModal sale={receipt} settings={settings} onClose={() => setReceipt(null)} />}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  badge,
  icon,
  progress,
  progressColor = 'bg-adm-blue',
  foot,
}: {
  label: string
  value: React.ReactNode
  sub: React.ReactNode
  badge?: React.ReactNode
  icon?: React.ReactNode
  progress?: number
  progressColor?: string
  foot?: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-xl bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-adm-muted">{label}</span>
        {badge ?? icon}
      </div>
      <div className="mt-2 truncate text-[28px] font-bold leading-tight tracking-tight tabular-nums text-adm-primary">{value}</div>
      <div className="mt-0.5 truncate text-sm text-adm-muted">{sub}</div>
      {progress !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-adm-low">
          <div className={`h-full rounded-full ${progressColor}`} style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
        </div>
      )}
      {foot && <div className="mt-auto flex pt-3 text-xs text-adm-muted">{foot}</div>}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded border border-adm-high px-2 py-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

function ActionLink({ to, icon: Icon, children }: { to: string; icon: typeof Printer; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-lg border border-adm-high px-3.5 py-2.5 text-sm font-semibold hover:bg-adm-low">
      <Icon size={16} className="text-adm-muted" /> {children}
    </Link>
  )
}
