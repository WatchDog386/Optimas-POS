import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  CalendarDays,
  Receipt,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { useSession } from '../session'
import type { PaymentMethod, Sale } from '../db/types'
import { money, moneyShort } from '../lib/money'

const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', account: 'On account' }

function startOfDay(d = new Date()): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export default function DashboardPage() {
  const { user, shift } = useSession()
  const settings = useSettings()
  const todayStart = useMemo(() => startOfDay(), [])

  const sales = useLiveQuery(() => db.sales.where('createdAt').aboveOrEqual(todayStart).toArray(), [todayStart], [] as Sale[])
  const products = useLiveQuery(() => db.products.toArray(), [], [])
  const customers = useLiveQuery(() => db.customers.count(), [], 0)
  const jobs = useLiveQuery(() => db.jobs.where('status').notEqual('collected').count(), [], 0)
  const recentSales = useLiveQuery(
    () => db.sales.where('createdAt').aboveOrEqual(todayStart).reverse().limit(8).sortBy('createdAt'),
    [todayStart],
    [] as Sale[],
  )

  const stats = useMemo(() => {
    const valid = sales.filter((s) => s.status !== 'voided')
    const positive = valid.filter((s) => s.total >= 0)
    const revenue = positive.reduce((s, x) => s + x.total, 0)
    const refunds = valid.filter((s) => s.total < 0).reduce((s, x) => s - x.total, 0)
    let cost = 0
    for (const s of valid) for (const l of s.lines) cost += l.qty * l.unitCost
    const profit = revenue - cost - Math.abs(refunds)
    const avg = positive.length ? Math.round(revenue / positive.length) : 0
    const byMethod: Record<PaymentMethod, number> = { cash: 0, mpesa: 0, card: 0, account: 0 }
    for (const s of valid) {
      for (const p of s.payments) byMethod[p.method] += p.amount
      byMethod.cash -= s.change
    }
    return { count: positive.length, revenue, profit, avg, refunds: Math.abs(refunds), byMethod }
  }, [sales])

  const lowStock = useMemo(
    () =>
      products
        .filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel)
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 6),
    [products],
  )

  const weekStart = useMemo(() => startOfDay(new Date(Date.now() - 6 * 86400000)), [])
  const weekSales = useLiveQuery(
    () => db.sales.where('createdAt').aboveOrEqual(weekStart).toArray(),
    [weekStart],
    [] as Sale[],
  )
  const weekRevenue = useMemo(
    () => weekSales.filter((s) => s.status !== 'voided' && s.total >= 0).reduce((s, x) => s + x.total, 0),
    [weekSales],
  )

  const today = new Date()
  const dateLabel = today.toLocaleDateString('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  const cards = [
    {
      label: 'Sales today',
      value: String(stats.count),
      sub: `${money(stats.revenue, settings.currency)} collected`,
      icon: Receipt,
      bg: 'bg-[#2196F3]',
      to: '/sales',
    },
    {
      label: 'Gross profit',
      value: money(stats.profit, settings.currency),
      sub: stats.refunds > 0 ? `${money(stats.refunds, settings.currency)} in refunds` : 'No refunds today',
      icon: TrendingUp,
      bg: 'bg-[#1e3f46]',
      to: '/reports',
    },
    {
      label: '7-day sales',
      value: moneyShort(weekRevenue),
      sub: `${money(weekRevenue, settings.currency)} this week`,
      icon: Banknote,
      bg: 'bg-[#FDD835] text-slate-900',
      to: '/reports',
    },
    {
      label: 'Open jobs',
      value: String(jobs),
      sub: jobs === 0 ? 'Workshop is clear' : 'Service jobs in progress',
      icon: Wrench,
      bg: 'bg-[#E53935]',
      to: '/service',
    },
  ]

  const panels = [
    {
      title: 'Low stock',
      body:
        lowStock.length === 0
          ? 'Every tracked part is above its reorder level.'
          : `${lowStock.length} part${lowStock.length === 1 ? '' : 's'} at or below reorder level. Restock soon.`,
      action: 'Review inventory',
      to: '/inventory',
      perm: 'inventory' as const,
      btn: 'btn-primary',
    },
    {
      title: 'Service bay',
      body:
        jobs === 0
          ? 'No open service jobs. Create one from the Service page when a bike comes in.'
          : `${jobs} job${jobs === 1 ? '' : 's'} still open. Follow up with customers waiting for parts.`,
      action: 'Open service jobs',
      to: '/service',
      btn: 'btn-primary',
    },
    {
      title: 'Shift',
      body: shift
        ? `Shift open since ${new Date(shift.openedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}. Float ${money(shift.openingFloat, settings.currency)}.`
        : 'No shift is open. Open a shift before taking cash sales.',
      action: shift ? 'View shift' : 'Open a shift',
      to: '/shift',
      btn: 'btn-primary',
    },
    {
      title: 'Customers',
      body: `${customers} customer${customers === 1 ? '' : 's'} on file. Average sale today ${money(stats.avg, settings.currency)}.`,
      action: 'Manage customers',
      to: '/customers',
      btn: 'btn-primary',
    },
  ]

  const methodTotal = Object.values(stats.byMethod).reduce((a, b) => a + b, 0) || 1

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[34px] font-light leading-none tracking-tight text-slate-700">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {greeting} <span className="text-base">👋</span> {user?.name} · {dateLabel}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ label, value, sub, icon: Icon, bg, to }) => (
              <Link
                key={label}
                to={to}
                className={`group relative overflow-hidden rounded-2xl p-4 text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg ${bg}`}
              >
                <div className="flex items-start justify-between gap-2">
                <div className="text-3xl font-extrabold leading-tight">{value}</div>
                <Icon size={28} className="shrink-0 opacity-80" />
              </div>
              <div className="mt-2 text-base font-bold">{label}</div>
              <div className="mt-1 text-sm opacity-90">{sub}</div>
              <div className="mt-3 flex items-center gap-1 text-sm font-bold">
                More info <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
              </div>
              </Link>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {panels.map(({ title, body, action, to, btn }) => (
              <div key={title} className="card flex flex-col p-4">
                <h2 className="text-lg font-bold text-navy-900">{title}</h2>
                <p className="mt-1 flex-1 text-base text-slate-600">{body}</p>
                <div className="mt-3">
                  <Link to={to} className={`${btn} mt-auto self-start`}>
                    {action}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between bg-[#3d5160] px-4 py-3">
              <h2 className="text-lg font-bold uppercase tracking-wider text-white">Today's sales</h2>
              <Link to="/sales" className="flex items-center gap-1 text-base font-semibold text-white/80 hover:text-white">
                All sales <ArrowRight size={15} />
              </Link>
            </div>
            {recentSales.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">No sales yet today. Head to Sell when the first customer walks in.</p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {recentSales
                  .slice()
                  .reverse()
                  .map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-bold text-slate-800">{s.receiptNo}</div>
                        <div className="text-sm text-slate-500">
                          {new Date(s.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                          {' · '}
                          {s.lines.reduce((n, l) => n + l.qty, 0)} item
                          {s.lines.reduce((n, l) => n + l.qty, 0) === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-base font-bold ${s.total < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                          {money(s.total, settings.currency)}
                        </div>
                        <div className="text-sm text-slate-500">{s.payments.map((p) => METHOD_LABEL[p.method]).join(', ') || '—'}</div>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="text-lg font-bold text-navy-900">Payment mix today</h2>
            <ul className="mt-3 space-y-3">
              {(Object.keys(stats.byMethod) as PaymentMethod[]).map((m) => {
                const amount = stats.byMethod[m]
                const pct = Math.max(0, Math.round((amount / methodTotal) * 100))
                return (
                  <li key={m}>
                    <div className="flex items-center justify-between text-base">
                      <span className="font-semibold text-slate-700">{METHOD_LABEL[m]}</span>
                      <span className="tabular-nums text-slate-600">{money(amount, settings.currency)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${m === 'cash' ? 'bg-emerald-500' : m === 'mpesa' ? 'bg-brand-500' : m === 'card' ? 'bg-violet-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-navy-900">Low stock</h2>
              <Link to="/inventory" className="text-base font-semibold text-brand-600 hover:text-brand-700">
                Inventory
              </Link>
            </div>
            {lowStock.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Nothing needs reordering.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {lowStock.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-800">{p.name}</div>
                      <div className="text-sm text-slate-500">{p.sku}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold ${p.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                      {p.stock} left
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 text-lg font-bold text-navy-900">
              <CalendarDays size={18} className="text-brand-600" /> Shop at a glance
            </div>
            <dl className="mt-3 space-y-2.5 text-base">
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-slate-500">
                  <Users size={16} /> Customers
                </dt>
                <dd className="font-semibold text-slate-800">{customers}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-slate-500">
                  <Boxes size={16} /> Active parts
                </dt>
                <dd className="font-semibold text-slate-800">{products.filter((p) => p.active).length}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-slate-500">
                  <Truck size={16} /> Low stock
                </dt>
                <dd className="font-semibold text-slate-800">{lowStock.length}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-slate-500">
                  <Wallet size={16} /> Shift
                </dt>
                <dd className={`font-semibold ${shift ? 'text-emerald-600' : 'text-red-600'}`}>{shift ? 'Open' : 'Closed'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-slate-500">
                  <AlertTriangle size={16} /> Avg sale
                </dt>
                <dd className="font-semibold text-slate-800">{money(stats.avg, settings.currency)}</dd>
              </div>
            </dl>
          </div>

          <Link to="/sell" className="btn-primary flex w-full py-3">
            Start a new sale
          </Link>
        </div>
      </div>
    </div>
  )
}
