import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  CheckCircle2,
  FileText,
  Package,
  Plus,
  Receipt,
  ScrollText,
  Settings as SettingsIcon,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { useSession } from '../session'
import type { LogEntry, PaymentMethod, Sale } from '../db/types'
import { money, moneyShort } from '../lib/money'
import { Badge, Empty, ListPanel } from '../components/ui'

const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', account: 'On account' }
const METHOD_COLOR: Record<PaymentMethod, string> = { cash: '#22c55e', mpesa: '#2c8286', card: '#8b5cf6', account: '#fbbf24' }

function startOfDay(d = new Date()): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export default function DashboardPage() {
  const { user, shift, can } = useSession()
  const settings = useSettings()
  const todayStart = useMemo(() => startOfDay(), [])
  const [cardSlide, setCardSlide] = useState(0)
  const isAdmin = can('users')

  const sales = useLiveQuery(() => db.sales.where('createdAt').aboveOrEqual(todayStart).toArray(), [todayStart], [] as Sale[])
  const products = useLiveQuery(() => db.products.toArray(), [], [])
  const customers = useLiveQuery(() => db.customers.count(), [], 0)
  const jobs = useLiveQuery(() => db.jobs.where('status').notEqual('collected').count(), [], 0)
  const recentSales = useLiveQuery(
    () => db.sales.where('createdAt').aboveOrEqual(todayStart).reverse().limit(8).sortBy('createdAt'),
    [todayStart],
    [] as Sale[],
  )
  const recentLogs = useLiveQuery(
    () => (isAdmin ? db.logs.orderBy('at').reverse().limit(5).toArray() : Promise.resolve<LogEntry[]>([])),
    [isAdmin],
    [] as LogEntry[],
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
  const weekCount = useMemo(
    () => weekSales.filter((s) => s.status !== 'voided' && s.total >= 0).length,
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
      hero: money(stats.revenue, settings.currency),
      right: `${stats.count} sale${stats.count === 1 ? '' : 's'}`,
      meta: `Avg sale ${money(stats.avg, settings.currency)}`,
      badge: 'Live',
      act: { label: 'New sale', to: '/sell', icon: Plus },
      icon: Receipt,
      bg: 'bg-[#2480E8]',
      grad: 'linear-gradient(135deg, #2480E8 0%, #0B3F78 100%)',
      strip: 'bg-[#1565C0] group-hover:bg-[#0F4F9A]',
      to: '/sales',
    },
    {
      label: 'Gross profit',
      value: money(stats.profit, settings.currency),
      sub: stats.refunds > 0 ? `${money(stats.refunds, settings.currency)} in refunds` : 'No refunds today',
      hero: money(stats.profit, settings.currency),
      right: stats.revenue > 0 ? `${Math.round((stats.profit / stats.revenue) * 100)}% margin` : 'No sales yet',
      meta: stats.refunds > 0 ? `${money(stats.refunds, settings.currency)} in refunds` : 'No refunds today',
      badge: 'After costs',
      act: { label: 'Sales', to: '/sales', icon: Receipt },
      icon: TrendingUp,
      bg: 'bg-[#2F8F54]',
      grad: 'linear-gradient(135deg, #2F8F54 0%, #144B2A 100%)',
      strip: 'bg-[#1F6B3C] group-hover:bg-[#15522C]',
      to: '/reports',
    },
    {
      label: '7-day sales',
      value: moneyShort(weekRevenue),
      sub: `${money(weekRevenue, settings.currency)} this week`,
      hero: money(weekRevenue, settings.currency),
      right: `${weekCount} sale${weekCount === 1 ? '' : 's'}`,
      meta: `Daily avg ${money(Math.round(weekRevenue / 7), settings.currency)}`,
      badge: 'This week',
      act: { label: 'New sale', to: '/sell', icon: Plus },
      icon: Banknote,
      bg: 'bg-[#FABF24]',
      grad: 'linear-gradient(135deg, #FABF24 0%, #7A5A02 100%)',
      strip: 'bg-[#D19E00] group-hover:bg-[#B38600]',
      to: '/reports',
    },
    {
      label: 'Open jobs',
      value: String(jobs),
      sub: jobs === 0 ? 'Workshop is clear' : 'Service jobs in progress',
      hero: String(jobs),
      right: jobs > 0 ? 'In workshop' : 'All clear',
      meta: jobs === 0 ? 'Workshop is clear' : 'Service jobs in progress',
      badge: 'Workshop',
      act: { label: 'New job', to: '/service?new=1', icon: Plus },
      icon: Wrench,
      bg: 'bg-[#E23C37]',
      grad: 'linear-gradient(135deg, #E23C37 0%, #6E1512 100%)',
      strip: 'bg-[#B32420] group-hover:bg-[#8F1B18]',
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
      icon: Package,
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
      icon: Wrench,
    },
    {
      title: 'Shift',
      body: shift
        ? `Shift open since ${new Date(shift.openedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}. Float ${money(shift.openingFloat, settings.currency)}.`
        : 'No shift is open. Open a shift before taking cash sales.',
      action: shift ? 'View shift' : 'Open a shift',
      to: '/shift',
      btn: 'btn-primary',
      icon: Wallet,
    },
    {
      title: 'Customers',
      body: `${customers} customer${customers === 1 ? '' : 's'} on file. Average sale today ${money(stats.avg, settings.currency)}.`,
      action: 'Manage customers',
      to: '/customers',
      btn: 'btn-primary',
      icon: Users,
    },
  ]

  const methodTotal = Object.values(stats.byMethod).reduce((a, b) => a + b, 0) || 1

  const activeMethods = (Object.keys(stats.byMethod) as PaymentMethod[]).filter((m) => stats.byMethod[m] > 0)
  const methodPct = (m: PaymentMethod) => Math.max(0, Math.round((stats.byMethod[m] / methodTotal) * 100))
  let donutAcc = 0
  const donutStops = activeMethods
    .map((m) => {
      const start = donutAcc
      donutAcc += (stats.byMethod[m] / methodTotal) * 100
      return `${METHOD_COLOR[m]} ${start}% ${donutAcc}%`
    })
    .join(', ')

  const tiles = [
    { label: 'Customers', value: String(customers), icon: Users, bg: 'bg-[#FFC107]', fg: 'text-black', to: '/customers' },
    {
      label: 'Active parts',
      value: String(products.filter((p) => p.active).length),
      icon: Boxes,
      bg: 'bg-[#2E9E4F]',
      fg: 'text-white',
      to: '/inventory',
    },
    { label: 'Low stock', value: String(lowStock.length), icon: Truck, bg: 'bg-[#E84545]', fg: 'text-white', to: '/inventory' },
    {
      label: 'Shift',
      value: shift ? 'Open' : 'Closed',
      icon: Wallet,
      bg: 'bg-[#2BC4E8]',
      fg: 'text-black',
      to: '/shift',
    },
    {
      label: 'Avg sale',
      value: money(stats.avg, settings.currency),
      icon: AlertTriangle,
      bg: 'bg-[#7E57C2]',
      fg: 'text-white',
      to: '/reports',
    },
  ]

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[26px] font-light leading-none tracking-tight text-slate-700 sm:text-[34px]">Dashboard</h1>
          <p className="text-[11px] text-slate-500 sm:text-sm">
            {greeting} <span className="text-base">👋</span> {user?.name} · {dateLabel}
          </p>
        </div>
        <Link
          to="/sell"
          className="rounded-full border border-brand-500 px-3.5 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 sm:hidden"
        >
          Start a new sale
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <div
            className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4"
            onScroll={(e) => {
              const el = e.currentTarget
              const pitch = el.scrollWidth / cards.length
              setCardSlide(Math.round(el.scrollLeft / pitch))
            }}
          >
            {cards.map(({ label, value, sub, hero, right, meta, badge, act, icon: Icon, bg, grad, strip, to }) => (
              <div
                key={label}
                className={`group relative min-w-full shrink-0 snap-start overflow-hidden rounded-xl text-white shadow-md transition duration-150 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-[0.98] sm:min-w-0 ${bg}`}
              >
                <div className="pointer-events-none absolute inset-0 sm:hidden" style={{ background: grad }} />
                {/* Decorative arcs, top-right (mobile) */}
                <span className="pointer-events-none absolute -right-12 -top-14 h-40 w-40 rounded-full border border-white/15 sm:hidden" />
                <span className="pointer-events-none absolute -right-4 -top-24 h-40 w-40 rounded-full border border-white/10 sm:hidden" />
                {/* Mobile: reference-style card */}
                <div className="relative flex flex-col gap-3.5 p-4 sm:hidden">
                  <Link to={to} aria-label={`${label}: ${value}. Open details.`} className="block min-w-0">
                    <div className="text-[11px] font-medium opacity-80">{label}</div>
                    <div className="mt-1.5 flex items-end justify-between gap-3">
                      <span className="min-w-0 truncate text-[26px] font-bold leading-none">{hero}</span>
                      <span className="shrink-0 pb-0.5 text-sm font-semibold opacity-90">{right}</span>
                    </div>
                  </Link>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Link
                      to={to}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-white/70 bg-white/5 px-3 py-2.5 text-[13px] font-semibold transition hover:bg-white/15"
                    >
                      <FileText size={14} />
                      Details
                    </Link>
                    <Link
                      to={act.to}
                      aria-label={act.label}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-white/70 bg-white/5 px-3 py-2.5 text-[13px] font-semibold transition hover:bg-white/15"
                    >
                      <act.icon size={14} />
                      {act.label}
                    </Link>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate opacity-90">{meta}</span>
                    <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">{badge}</span>
                  </div>
                </div>
                {/* Desktop: original layout */}
                <Link
                  to={to}
                  aria-label={`${label}: ${value}. Open details.`}
                  className="hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 sm:block"
                >
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 truncate text-3xl font-extrabold leading-tight">{value}</div>
                      <Icon size={44} className="shrink-0 text-black/20 transition duration-150 group-hover:scale-110 group-hover:text-black/30" />
                    </div>
                    <div className="mt-1 text-base font-semibold">{label}</div>
                    <div className="mt-0.5 text-sm opacity-90">{sub}</div>
                  </div>
                  <div
                    className={`flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-bold uppercase tracking-wide transition duration-150 ${strip}`}
                  >
                    More info
                    <ArrowRight size={14} className="transition duration-150 group-hover:translate-x-1" />
                  </div>
                </Link>
              </div>
            ))}
          </div>

          {/* Carousel dots */}
          <div className="mt-1 flex justify-center gap-1.5 sm:hidden">
            {cards.map((c, i) => (
              <span
                key={c.label}
                className={`h-1.5 w-1.5 rounded-full transition ${i === cardSlide ? 'bg-slate-700' : 'bg-slate-300'}`}
              />
            ))}
          </div>

          {/* Mobile: quick actions — circles only, no panel wrap */}
          <div className="sm:hidden">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">Quick Actions</span>
              <Link
                to="/settings"
                className="rounded-full border border-slate-400 px-3.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-brand-500 hover:text-brand-600"
              >
                Manage
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-x-2 gap-y-4">
              {panels.map(({ title, to, icon: Icon }) => (
                <Link key={title} to={to} className="flex flex-col items-center gap-2 transition active:scale-95">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-ink">
                    <Icon size={20} className="text-white" />
                  </span>
                  <span className="text-center text-[11px] font-medium leading-tight text-slate-600">{title}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Desktop: description panels */}
          <div className="hidden gap-4 sm:grid sm:grid-cols-2">
            {panels.map(({ title, body, action, to, btn }) => (
              <div key={title} className="card flex flex-col p-4">
                <h2 className="text-sm font-bold text-navy-900 sm:text-lg">{title}</h2>
                <p className="mt-1 flex-1 text-xs text-slate-600 sm:text-base">{body}</p>
                <div className="mt-3">
                  <Link to={to} className={`${btn} mt-auto self-start`}>
                    {action}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Mobile: heading + status only */}
          <div className="card p-4 sm:hidden">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Receipt size={15} className="text-brand-500" />
              Today's sales
            </div>
            {recentSales.length === 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                <Receipt size={14} className="shrink-0 text-slate-400" />
                No sales yet today.
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                <CheckCircle2 size={14} className="shrink-0 text-cta" />
                {stats.count} sale{stats.count === 1 ? '' : 's'} · {money(stats.revenue, settings.currency)} collected
              </p>
            )}
          </div>

          <div className="hidden sm:block">
            <ListPanel
              title="Today's sales"
            actions={
              <Link to="/sales" className="flex items-center gap-1 text-sm font-semibold text-white/80 hover:text-white">
                All sales <ArrowRight size={15} />
              </Link>
            }
            footer={
              <>
                <span>
                  <strong>{stats.count}</strong> sale{stats.count === 1 ? '' : 's'} today
                </span>
                <span className="text-xs text-slate-500">{money(stats.revenue, settings.currency)} collected</span>
              </>
            }
          >
            {recentSales.length === 0 ? (
              <Empty>No sales yet today. Head to Sell when the first customer walks in.</Empty>
            ) : (
              <table className="w-full">
                <thead className="table-head">
                  <tr>
                    <th>Receipt</th>
                    <th>Time</th>
                    <th>Items</th>
                    <th>Method</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales
                    .slice()
                    .reverse()
                    .map((s) => {
                      const items = s.lines.reduce((n, l) => n + l.qty, 0)
                      return (
                        <tr key={s.id} className="table-row">
                          <td className="font-semibold">{s.receiptNo}</td>
                          <td className="text-xs">
                            {new Date(s.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="text-xs">
                            {items} item{items === 1 ? '' : 's'}
                          </td>
                          <td className="text-xs">{s.payments.map((p) => METHOD_LABEL[p.method]).join(', ') || '—'}</td>
                          <td className={`text-right font-semibold ${s.total < 0 ? 'text-red-600' : ''}`}>{money(s.total, settings.currency)}</td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            )}
            </ListPanel>
          </div>

          {isAdmin && (
            <ListPanel
              title="Admin"
              barClassName="hidden sm:flex"
              toolbarClassName="hidden sm:flex"
              actions={
                <Link to="/logs" className="flex items-center gap-1 text-sm font-semibold text-white/80 hover:text-white">
                  Activity log <ArrowRight size={15} />
                </Link>
              }
              toolbar={
                <>
                  <div className="flex flex-wrap gap-2">
                    <Link to="/staff" className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/20">
                      <UserCog size={13} className="mr-1 inline -translate-y-px" /> Staff
                    </Link>
                    <Link to="/logs" className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/20">
                      <ScrollText size={13} className="mr-1 inline -translate-y-px" /> Logs
                    </Link>
                    <Link to="/settings" className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/20">
                      <SettingsIcon size={13} className="mr-1 inline -translate-y-px" /> Settings
                    </Link>
                  </div>
                  <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10">Last {recentLogs.length} events</span>
                </>
              }
            >
              {recentLogs.length === 0 ? (
                <Empty>No activity recorded yet.</Empty>
              ) : (
                <table className="w-full">
                  <thead className="table-head">
                    <tr>
                      <th>Event</th>
                      <th>Detail</th>
                      <th className="hidden sm:table-cell">User</th>
                      <th className="text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLogs.map((l, i) => (
                      <tr key={`${l.at}-${i}`} className="table-row">
                        <td className="font-semibold">{l.action}</td>
                        <td className="text-xs">{l.detail ?? '—'}</td>
                        <td className="hidden text-xs sm:table-cell">{l.userName ?? '—'}</td>
                        <td className="text-right text-xs">
                          {new Date(l.at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ListPanel>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="text-sm font-bold text-navy-900 sm:text-lg">Payment mix today</h2>

            {/* Mobile: donut graph */}
            <div className="sm:hidden">
              {activeMethods.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">No payments recorded yet today.</p>
              ) : (
                <>
                  <div className="mt-3 flex justify-center">
                    <div className="h-36 w-36 rounded-full p-5" style={{ background: `conic-gradient(${donutStops})` }}>
                      <div className="grid h-full w-full place-items-center rounded-full bg-white text-center">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-400">Total</div>
                          <div className="text-sm font-bold text-slate-800">{money(stats.revenue, settings.currency)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
                    {activeMethods.map((m) => (
                      <span key={m} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <span className="h-2 w-2 rounded-full" style={{ background: METHOD_COLOR[m] }} />
                        {METHOD_LABEL[m]} {methodPct(m)}%
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Desktop: bars */}
            <ul className="mt-3 hidden space-y-3 sm:block">
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

          {/* Mobile: heading + status only */}
          <div className="card p-4 sm:hidden">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Boxes size={15} className="text-amber-500" />
              Low stock
            </div>
            {lowStock.length === 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                <CheckCircle2 size={14} className="shrink-0 text-cta" />
                Nothing needs reordering.
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                <AlertTriangle size={14} className="shrink-0 text-amber-500" />
                {lowStock.length} part{lowStock.length === 1 ? '' : 's'} at or below reorder level.
              </p>
            )}
          </div>

          <div className="hidden sm:block">
            <ListPanel
              title="Low stock"
              actions={
                <Link to="/inventory" className="flex items-center gap-1 text-sm font-semibold text-white/80 hover:text-white">
                  Inventory <ArrowRight size={14} />
                </Link>
              }
            >
            {lowStock.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing needs reordering.</p>
            ) : (
              <table className="w-full">
                <thead className="table-head">
                  <tr>
                    <th>Part</th>
                    <th className="text-right">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((p) => (
                    <tr key={p.id} className="table-row">
                      <td>
                        <div className="font-semibold">{p.name}</div>
                        <div className="font-mono text-xs text-slate-500">{p.sku}</div>
                      </td>
                      <td className="text-right">
                        <Badge tone={p.stock <= 0 ? 'red' : 'amber'}>{p.stock}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            </ListPanel>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-1">
            {tiles.map(({ label, value, icon: Icon, bg, fg, to }) => (
              <Link
                key={label}
                to={to}
                aria-label={`${label}: ${value}`}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-900 sm:gap-4 sm:px-4 sm:py-3 ${bg}`}
              >
                <Icon size={26} className={`shrink-0 ${fg}`} strokeWidth={2.25} />
                <div className={`min-w-0 ${fg}`}>
                  <div className="text-sm font-normal leading-snug opacity-90 sm:text-[15px]">{label}</div>
                  <div className="truncate text-sm font-bold leading-snug sm:text-[15px]">{value}</div>
                </div>
              </Link>
            ))}
          </div>

          <Link to="/sell" className="btn-primary hidden w-full py-3 sm:flex">
            Start a new sale
          </Link>
        </div>
      </div>
    </div>
  )
}
