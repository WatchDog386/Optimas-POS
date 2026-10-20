import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
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

function startOfDay(d = new Date()): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export default function DashboardPage() {
  const { user, shift, can } = useSession()
  const settings = useSettings()
  const todayStart = useMemo(() => startOfDay(), [])
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
      bg: 'bg-[#2480E8]',
      strip: 'bg-[#1565C0] group-hover:bg-[#0F4F9A]',
      to: '/sales',
    },
    {
      label: 'Gross profit',
      value: money(stats.profit, settings.currency),
      sub: stats.refunds > 0 ? `${money(stats.refunds, settings.currency)} in refunds` : 'No refunds today',
      icon: TrendingUp,
      bg: 'bg-[#2F8F54]',
      strip: 'bg-[#1F6B3C] group-hover:bg-[#15522C]',
      to: '/reports',
    },
    {
      label: '7-day sales',
      value: moneyShort(weekRevenue),
      sub: `${money(weekRevenue, settings.currency)} this week`,
      icon: Banknote,
      bg: 'bg-[#FABF24]',
      strip: 'bg-[#D19E00] group-hover:bg-[#B38600]',
      to: '/reports',
    },
    {
      label: 'Open jobs',
      value: String(jobs),
      sub: jobs === 0 ? 'Workshop is clear' : 'Service jobs in progress',
      icon: Wrench,
      bg: 'bg-[#E23C37]',
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
            {cards.map(({ label, value, sub, icon: Icon, bg, strip, to }) => (
              <Link
                key={label}
                to={to}
                aria-label={`${label}: ${value}. Open details.`}
                className={`group relative overflow-hidden rounded-xl text-white shadow-md transition duration-150 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.98] ${bg}`}
              >
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-3xl font-extrabold leading-tight">{value}</div>
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

          {isAdmin && (
            <ListPanel
              title="Admin"
              actions={
                <Link to="/logs" className="flex items-center gap-1 text-sm font-semibold text-white/80 hover:text-white">
                  Activity log <ArrowRight size={15} />
                </Link>
              }
              toolbar={
                <>
                  <div className="flex flex-wrap gap-2">
                    <Link to="/staff" className="rounded-md bg-[#2f3f4c] px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-[#25333e]">
                      <UserCog size={13} className="mr-1 inline -translate-y-px" /> Staff
                    </Link>
                    <Link to="/logs" className="rounded-md bg-[#2f3f4c] px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-[#25333e]">
                      <ScrollText size={13} className="mr-1 inline -translate-y-px" /> Logs
                    </Link>
                    <Link to="/settings" className="rounded-md bg-[#2f3f4c] px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-[#25333e]">
                      <SettingsIcon size={13} className="mr-1 inline -translate-y-px" /> Settings
                    </Link>
                  </div>
                  <span className="rounded-md bg-[#2f3f4c] px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10">Last {recentLogs.length} events</span>
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
                      <th>User</th>
                      <th className="text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLogs.map((l, i) => (
                      <tr key={`${l.at}-${i}`} className="table-row">
                        <td className="font-semibold">{l.action}</td>
                        <td className="text-xs">{l.detail ?? '—'}</td>
                        <td className="text-xs">{l.userName ?? '—'}</td>
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

          <div className="space-y-2.5">
            {tiles.map(({ label, value, icon: Icon, bg, fg, to }) => (
              <Link
                key={label}
                to={to}
                aria-label={`${label}: ${value}`}
                className={`flex items-center gap-4 rounded-lg px-4 py-3 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-900 ${bg}`}
              >
                <Icon size={26} className={`shrink-0 ${fg}`} strokeWidth={2.25} />
                <div className={`min-w-0 ${fg}`}>
                  <div className="text-[15px] font-normal leading-snug opacity-90">{label}</div>
                  <div className="text-[15px] font-bold leading-snug">{value}</div>
                </div>
              </Link>
            ))}
          </div>

          <Link to="/sell" className="btn-primary flex w-full py-3">
            Start a new sale
          </Link>
        </div>
      </div>
    </div>
  )
}
