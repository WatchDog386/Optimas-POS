import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowUpRight,
  BarChart2,
  Bell,
  Building2,
  Calendar,
  ChevronRight,
  DollarSign,
  ExternalLink,
  FileText,
  Group,
  Package,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { useSession } from '../session'
import type { Category, PaymentMethod, Sale } from '../db/types'
import { summarizeShift } from '../db/shifts'

const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', account: 'On account' }

function startOfDay(d = new Date()): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

function formatKsh(value: number): string {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value / 100)
}

interface HourlyBarProps {
  x: number
  mpesaHeight: number
  cashHeight: number
  otherHeight: number
  isPeak: boolean
  peakLabel: string
}

function HourlyBar({ x, mpesaHeight, cashHeight, otherHeight, isPeak, peakLabel }: HourlyBarProps) {
  const peakY = 230 - mpesaHeight - cashHeight - otherHeight - 8
  const transform = isPeak ? `translate(${x + 15}, ${peakY})` : ''
  return (
    <g key={`bar-${x}`}>
      <rect fill="url(#mpesaGrad)" height={mpesaHeight} rx={3} width={30} x={x} y={230 - mpesaHeight} />
      <rect fill="url(#cashGrad)" height={cashHeight} rx={2} width={30} x={x} y={230 - mpesaHeight - cashHeight} />
      <rect fill="url(#otherGrad)" height={otherHeight} rx={2} width={30} x={x} y={230 - mpesaHeight - cashHeight - otherHeight} />
      {isPeak && (
        <g transform={transform}>
          <circle cx="0" cy="0" fill="#00a859" r="4" />
          <line stroke="#00a859" strokeWidth="1.5" x1="0" x2="0" y1="0" y2="-12" />
          <rect fill="#0f172a" height="16" rx={3} width={84} x="-42" y="-28" />
          <text fill="#ffffff" fontFamily="Inter" fontSize="10" fontWeight="600" textAnchor="middle" x="0" y="-17">Peak: {peakLabel}</text>
        </g>
      )}
    </g>
  )
}

export default function DashboardPage() {
  const { user, shift } = useSession()
  const settings = useSettings()
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const [catalogQuery, setCatalogQuery] = useState('')
  const todayStart = useMemo(() => startOfDay(), [])
  const [cashierFilter, setCashierFilter] = useState<number | 'all'>('all')

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'F1') { event.preventDefault(); navigate('/sell') }
      if (event.key === 'F3') { event.preventDefault(); navigate('/inventory?new=1') }
      if (event.key === 'F4') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [navigate])

  const sales = useLiveQuery(() => db.sales.where('createdAt').aboveOrEqual(todayStart).toArray(), [todayStart], [] as Sale[])
  const products = useLiveQuery(() => db.products.toArray(), [], [] as import('../db/types').Product[])
  const users = useLiveQuery(() => db.users.toArray(), [], [])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [])
  const shiftSales = useLiveQuery(
    () => (shift?.id ? db.sales.where('shiftId').equals(shift.id).toArray() : Promise.resolve([] as Sale[])),
    [shift?.id],
    [] as Sale[],
  )
  const customerCredit = useLiveQuery(() => db.customers.where('balance').above(0).toArray(), [], [] as { balance: number; creditLimit: number }[])
  const customersMap = useLiveQuery(() => db.customers.toArray(), [], [] as { id: number; name: string; phone?: string; balance: number }[])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [] as Category[])
  const supplierNames = useMemo(() => Object.fromEntries(suppliers.map((supplier) => [supplier.id, supplier.name])), [suppliers])

  const cashierUsers = users.filter((staff) => staff.active && staff.role === 'cashier')
  const cashierSales = useMemo(
    () => (cashierFilter === 'all' ? sales : sales.filter((sale) => sale.userId === cashierFilter)),
    [sales, cashierFilter],
  )
  const recentTransactions = useMemo(
    () => [...cashierSales].filter((sale) => sale.status !== 'voided').sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    [cashierSales],
  )
  const shiftSummary = useMemo(() => {
    if (!shift) return undefined
    return summarizeShift(shift, shiftSales)
  }, [shift, shiftSales])

  const stats = useMemo(() => {
    const valid = cashierSales.filter((s) => s.status !== 'voided')
    const positive = valid.filter((s) => s.total >= 0)
    const revenue = positive.reduce((s, x) => s + x.total, 0)
    const refunds = valid.filter((s) => s.total < 0).reduce((s, x) => s - x.total, 0)
    let cost = 0
    for (const s of valid) for (const l of s.lines) cost += l.qty * l.unitCost
    const profit = revenue - cost - Math.abs(refunds)
    const avg = positive.length ? Math.round(revenue / positive.length) : 0
    const byMethod: Record<PaymentMethod, number> = { cash: 0, mpesa: 0, card: 0, account: 0 }
    const grossByMethod: Record<PaymentMethod, number> = { cash: 0, mpesa: 0, card: 0, account: 0 }
    for (const s of valid) {
      for (const p of s.payments) {
        byMethod[p.method] += p.amount
        if (s.total >= 0) grossByMethod[p.method] += p.amount
      }
      byMethod.cash -= s.change
      if (s.total >= 0) grossByMethod.cash -= s.change
    }
    return { count: positive.length, revenue, profit, avg, refunds: Math.abs(refunds), byMethod, grossByMethod }
  }, [cashierSales])

  const lowStock = useMemo(
    () =>
      products
        .filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel)
        .sort((a, b) => a.stock - b.stock),
    [products],
  )

  const totalStockValue = useMemo(() => {
    let val = 0
    for (const p of products) if (p.active && p.trackStock) val += p.stock * p.cost
    return val
  }, [products])

  const totalCredit = useMemo(() => customerCredit.reduce((s, c) => s + c.balance, 0), [customerCredit])
  const totalCreditLimit = useMemo(() => customerCredit.reduce((s, c) => s + c.creditLimit, 0), [customerCredit])
  const creditUtilization = totalCreditLimit > 0 ? Math.min(100, Math.round((totalCredit / totalCreditLimit) * 100)) : 0
  const activeStockProducts = products.filter((p) => p.active && p.trackStock)
  const stockCoverage = Math.min(100, Math.round((activeStockProducts.filter((p) => p.stock > p.reorderLevel).length / Math.max(1, activeStockProducts.length)) * 100))

  const categorySales = useMemo(() => {
    const catMap = new Map<number, { name: string; revenue: number; count: number }>()
    for (const s of cashierSales.filter(s => s.status !== 'voided' && s.total >= 0)) {
      for (const l of s.lines) {
        const p = products.find(pr => pr.id === l.productId)
        if (p?.categoryId) {
          const cat = catMap.get(p.categoryId) || { name: '', revenue: 0, count: 0 }
          const soldQty = Math.max(0, l.qty - (l.refundedQty ?? 0))
          cat.name = p.categoryId.toString()
          cat.revenue += soldQty * l.unitPrice
          cat.count += soldQty
          catMap.set(p.categoryId, cat)
        }
      }
    }
    return Array.from(catMap.entries())
      .map(([id, data]) => ({ ...data, name: categories.find(c => c.id === id)?.name || 'Unknown' }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
  }, [cashierSales, products, categories])

  const totalCatRevenue = categorySales.reduce((s, c) => s + c.revenue, 0) || 1
  const tenderTotal = Math.max(1, Object.values(stats.grossByMethod).reduce((sum, amount) => sum + Math.max(0, amount), 0))
  const tenderPercent = (amount: number) => Math.round((Math.max(0, amount) / tenderTotal) * 100)

  const hourlyData = useMemo(() => {
    const currentHour = new Date().getHours()
    const hours = Array.from({ length: 10 }, (_, index) => ({ hour: (currentHour - 9 + index + 24) % 24, mpesa: 0, cash: 0, other: 0 }))
    for (const sale of cashierSales) {
      if (sale.status === 'voided' || sale.total < 0) continue
      const hour = new Date(sale.createdAt).getHours()
      const row = hours.find((entry) => entry.hour === hour)
      if (!row) continue
      for (const payment of sale.payments) {
        if (payment.method === 'mpesa') row.mpesa += payment.amount
        else if (payment.method === 'cash') row.cash += payment.amount
        else row.other += payment.amount
      }
      row.cash = Math.max(0, row.cash - sale.change)
    }
    return hours.map((entry) => ({ ...entry, label: `${String(entry.hour).padStart(2, '0')}:00`, total: entry.mpesa + entry.cash + entry.other }))
  }, [cashierSales])
  const maxHourly = Math.max(1, ...hourlyData.map((entry) => entry.total))
  const peakHour = hourlyData.reduce((peak, entry) => (entry.total > peak.total ? entry : peak), hourlyData[0])

  const topPart = useMemo(() => {
    const parts = new Map<number, { name: string; units: number }>()
    for (const sale of cashierSales) {
      if (sale.status === 'voided' || sale.total < 0) continue
      for (const line of sale.lines) {
        if (!line.productId) continue
        const part = parts.get(line.productId) ?? { name: line.name, units: 0 }
        part.units += Math.max(0, line.qty - (line.refundedQty ?? 0))
        parts.set(line.productId, part)
      }
    }
    return [...parts.values()].filter((part) => part.units > 0).sort((a, b) => b.units - a.units)[0]
  }, [cashierSales])

  const searchCatalog = () => {
    const query = catalogQuery.trim()
    navigate(query ? `/inventory?q=${encodeURIComponent(query)}` : '/inventory')
  }

  const exportTodayCsv = () => {
    const rows = [
      ['Receipt', 'Time', 'Customer', 'Items', 'Amount (KES)', 'Tender'],
      ...cashierSales.filter((sale) => sale.status !== 'voided').sort((a, b) => b.createdAt - a.createdAt).map((sale) => [
        sale.receiptNo,
        new Date(sale.createdAt).toLocaleString('en-KE'),
        getCustomerName(sale.customerId),
        String(sale.lines.reduce((total, line) => total + Math.abs(line.qty), 0)),
        (sale.total / 100).toFixed(2),
        [...new Set(sale.payments.map((payment) => METHOD_LABEL[payment.method]))].join(' + '),
      ]),
    ]
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `optimas-sales-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const getCustomerName = (customerId?: number) => {
    if (!customerId) return 'Walk-in Customer'
    const c = customersMap.find(cust => cust.id === customerId)
    return c?.name || 'Unknown Customer'
  }

  const getCustomerAccount = (customerId?: number) => {
    if (!customerId) return 'Retail'
    const c = customersMap.find(cust => cust.id === customerId)
    return c?.phone ? `Account: ${c.phone}` : 'Account Customer'
  }

  const kpiCards = [
    {
      label: 'Gross Sales (Today)',
      value: formatKsh(stats.revenue),
      sub: `${stats.count} tickets · Avg ${formatKsh(stats.avg)}`,
      trend: 'Today',
      icon: DollarSign,
      gradient: 'kpi-gradient-blue',
      progress: null,
      action: { label: 'View Sales', to: '/sales', icon: FileText },
    },
    {
      label: 'Est. Gross Profit',
      value: formatKsh(stats.profit),
      sub: stats.refunds > 0 ? `${formatKsh(stats.refunds)} in refunds` : 'No refunds today',
      trend: `${stats.revenue ? Math.round((stats.profit / stats.revenue) * 100) : 0}% margin`,
      icon: TrendingUp,
      gradient: 'kpi-gradient-green',
      progress: Math.max(0, Math.min(100, Math.round((stats.profit / Math.max(1, stats.revenue)) * 100))),
      action: { label: 'Reports', to: '/reports', icon: BarChart2 },
    },
    {
      label: 'Cash & Till Balance',
      value: formatKsh(shiftSummary?.expectedCash ?? stats.byMethod.cash),
      sub: shift ? `Whole-shift till · M-Pesa: ${formatKsh(shiftSummary?.byMethod.mpesa ?? 0)}` : `Cash today · M-Pesa: ${formatKsh(stats.byMethod.mpesa)}`,
      trend: shift ? 'Shift open' : 'No open shift',
      icon: Wallet,
      gradient: 'kpi-gradient-teal',
      progress: null,
      action: { label: 'Reconcile', to: '/shift', icon: RotateCcw },
    },
    {
      label: 'Total Stock Value',
      value: formatKsh(totalStockValue),
      sub: `${activeStockProducts.length} active stock SKUs`,
      trend: `${stockCoverage}% above min`,
      icon: Package,
      gradient: 'kpi-gradient-violet',
      progress: stockCoverage,
      action: { label: 'Inventory', to: '/inventory', icon: Package },
    },
    {
      label: 'Customer Credit',
      value: formatKsh(totalCredit),
      sub: `${customerCredit.length} customer accounts with a balance`,
      trend: totalCreditLimit > 0 ? `${creditUtilization}% used` : customerCredit.length ? 'No limit set' : 'Clear',
      icon: Users,
      gradient: 'kpi-gradient-red',
      progress: creditUtilization,
      action: { label: 'Review', to: '/customers', icon: Group },
    },
    {
      label: 'Stock Attention',
      value: `${lowStock.length} SKUs`,
      sub: `${lowStock.filter(p => p.stock <= 0).length} zero stock, ${lowStock.filter(p => p.stock > 0).length} reorder alert`,
      trend: `Est. ${formatKsh(lowStock.reduce((s, p) => s + Math.max(0, p.reorderLevel - p.stock) * p.cost, 0))} req.`,
      icon: AlertCircle,
      gradient: 'kpi-gradient-amber',
      progress: null,
      action: { label: 'Auto PO', to: '/purchasing', icon: Truck },
    },
  ]

  return (
    <div className="min-h-full bg-mc-canvas">
      <section id="dashboard-print" className="hidden">
        <h1>{settings.shopName} · Store Executive Dashboard</h1>
        <p>Daily snapshot · {new Date().toLocaleString('en-KE')}</p>
        <table>
          <tbody>
            {kpiCards.map((card) => <tr key={card.label}><th>{card.label}</th><td>{card.value}</td></tr>)}
          </tbody>
        </table>
        <h2>Today’s transactions</h2>
        <table>
          <thead><tr><th>Receipt</th><th>Time</th><th>Customer</th><th>Amount</th><th>Tender</th></tr></thead>
          <tbody>
            {recentTransactions.map((sale) => <tr key={sale.id}>
              <td>{sale.receiptNo}</td>
              <td>{new Date(sale.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</td>
              <td>{getCustomerName(sale.customerId)}</td>
              <td>{formatKsh(sale.total)}</td>
              <td>{[...new Set(sale.payments.map((payment) => METHOD_LABEL[payment.method]))].join(' + ')}</td>
            </tr>)}
          </tbody>
        </table>
      </section>
      {/* Main content */}
      <div>
        {/* Top header */}
        <header className="sticky top-0 z-40 h-16 bg-white/80 backdrop-blur-xl border-b border-mc-line flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1.5 text-sm text-mc-muted">
              <span className="text-mc-body">{settings.shopName}</span>
              <ChevronRight size={14} className="text-mc-faint" />
              <span className="text-mc-ink font-semibold">Executive Dashboard</span>
            </nav>
          </div>

          <form className="relative hidden min-w-0 w-full max-w-xl flex-1 items-center md:flex" onSubmit={(event) => { event.preventDefault(); searchCatalog() }}>
            <Search size={18} className="absolute left-3 text-mc-faint" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search Part No, SKU, OEM, Barcode [Ctrl + K]"
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              className="w-full pl-9 pr-10 py-2 bg-mc-canvas border border-mc-line rounded-lg text-sm text-mc-body outline-none focus:border-mc-cobalt focus:ring-2 focus:ring-mc-cobalt/25 placeholder:text-mc-faint"
            />
            <kbd className="absolute right-2.5 px-1.5 py-0.5 rounded bg-mc-panel text-mc-muted text-[10px] font-medium">Ctrl+K</kbd>
          </form>

          <div className="flex items-center gap-2">
            <NavLink to="/sell" className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-mc-cobalt text-white rounded-lg font-medium hover:bg-mc-cobalt-hover transition shadow-sm">
              <Plus size={16} /> New Sale (F1)
            </NavLink>
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-mc-canvas rounded text-mc-body text-sm">
              <Building2 size={14} className="text-mc-muted" />
              <span>{settings.shopName}</span>
            </div>
            {settings.enabledPayments.includes('mpesa') && <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 bg-mc-canvas rounded text-mc-mpesa text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-mc-mpesa animate-pulse-dot" />
              M-Pesa Enabled
            </div>}
            <Link to="/notifications" aria-label="Notifications" className="rounded-full p-2 text-mc-muted transition hover:bg-mc-canvas hover:text-mc-body">
              <Bell size={20} />
            </Link>
            <div className="flex items-center gap-2 pl-2 ml-2 border-l border-mc-line">
              <div aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-mc-cobalt-soft text-xs font-bold text-mc-cobalt-hover">
                {(user?.name ?? 'O').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-semibold text-mc-ink">{user?.name}</p>
                <p className="text-[11px] text-mc-muted">{user?.role}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard content */}
        <main className="p-4 lg:p-6">
          {/* Top Operational Bar */}
          <div className="mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 lg:p-6 rounded-xl border border-mc-line shadow-sm">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-[24px] font-bold tracking-tight text-mc-ink">Store Executive Dashboard</h1>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-mc-cobalt-soft text-mc-cobalt-hover text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-mc-cobalt animate-pulse-dot" />
                  Local POS Data
                </span>
              </div>
              <p className="text-sm text-mc-muted">Sales, inventory movement, and till activity recorded at {settings.shopName}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-mc-canvas border border-mc-line rounded-lg text-sm font-medium text-mc-body">
                <Calendar size={16} className="text-mc-muted" />
                <span className="font-semibold">Today</span>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-mc-line bg-mc-canvas px-3 py-2 text-sm font-medium text-mc-body">
                <Group size={16} className="text-mc-muted" />
                <select
                  className="max-w-40 bg-transparent outline-none"
                  value={cashierFilter}
                  onChange={(e) => setCashierFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  aria-label="Filter dashboard by cashier"
                >
                  <option value="all">All Cashiers ({cashierUsers.length})</option>
                  {cashierUsers.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
                </select>
              </label>
              <div className="w-px h-6 bg-mc-line hidden sm:block" />
              <div className="flex items-center bg-mc-canvas border border-mc-line rounded-lg p-0.5">
                <button onClick={() => window.print()} className="px-2.5 py-1 text-mc-muted hover:text-mc-body text-[11px] font-medium rounded transition flex items-center gap-1" type="button">
                  <FileText size={14} /> PDF
                </button>
                <button onClick={exportTodayCsv} className="px-2.5 py-1 text-mc-muted hover:text-mc-body text-[11px] font-medium rounded transition flex items-center gap-1" type="button">
                  <FileText size={14} /> CSV
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Link to="/purchasing" className="flex items-center gap-1 px-3 py-2 bg-mc-panel text-mc-body rounded-lg font-medium hover:bg-mc-panel-2 transition">
                  <ArrowUpRight size={16} className="text-mc-cobalt" />
                  <span>Stock Inward</span>
                </Link>
                <Link to="/shift" className="flex items-center gap-1 px-3 py-2 bg-mc-panel text-mc-body rounded-lg font-medium hover:bg-mc-panel-2 transition">
                  <ExternalLink size={16} className="text-mc-muted" />
                  <span>Record Expense</span>
                </Link>
                <Link to="/inventory?new=1" className="flex items-center gap-1.5 px-4 py-2 bg-mc-cobalt text-white rounded-lg font-medium font-semibold hover:bg-mc-cobalt-hover transition shadow-sm">
                  <Plus size={16} /> Add Part (F3)
                </Link>
              </div>
            </div>
          </div>

          {/* 6 Core Enterprise KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            {kpiCards.map((card) => (
              <Link key={card.label} to={card.action.to} className="group block">
                <div className={`${card.gradient} flex h-full min-h-[132px] flex-col rounded-xl p-4 lg:p-5 relative overflow-hidden shadow-sm hover:shadow-md transition-shadow`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="min-w-0 text-[11px] font-bold uppercase tracking-wider text-white/70">{card.label}</span>
                    <span className="inline-flex max-w-[52%] shrink-0 items-center gap-0.5 truncate rounded px-1.5 py-0.5 text-right text-[11px] font-bold text-white/90 bg-white/10">
                      {card.trend}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[clamp(1.25rem,2vw,1.75rem)] font-bold tracking-tight text-white">{card.value}</span>
                    <span className="text-[12px] text-white/60 mt-0.5">{card.sub}</span>
                  </div>
                  <div className="mt-auto h-5 pt-3">
                    {card.progress !== null && <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                      <div className="bg-white/40 h-full rounded-full transition-all duration-300" style={{ width: `${card.progress}%` }} />
                    </div>}
                  </div>
                  {/* The icon appears on hover to keep the main figures clear. */}
                  <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <card.action.icon size={24} className="text-white/50" />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Charts & Analytics Section */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-6">
            {/* Hourly Revenue & Cashier Velocity */}
            <div className="xl:col-span-8 bg-white rounded-xl border border-mc-line p-4 lg:p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-[18px] font-semibold text-mc-ink">Hourly Sales & Tender Mix</h2>
                  <p className="text-sm text-mc-muted mt-0.5">Today's recorded sales by hour · refunds excluded</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-mc-cobalt-soft text-mc-cobalt-hover text-[11px] font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-mc-mpesa" />
                    M-Pesa ({tenderPercent(stats.grossByMethod.mpesa)}%)
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-green-100 text-green-700 text-[11px] font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-mc-cobalt" />
                    Cash ({tenderPercent(stats.grossByMethod.cash)}%)
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-100 text-mc-muted text-[11px] font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-mc-faint" />
                    Card / account ({tenderPercent(stats.grossByMethod.card + stats.grossByMethod.account)}%)
                  </span>
                </div>
              </div>

              {/* Chart Area */}
              <div className="relative h-72 flex flex-col justify-end pt-4 pb-2">
                {/* Grid Lines */}
                <div className="absolute inset-x-0 inset-y-6 flex flex-col justify-between pointer-events-none opacity-40">
                  <div className="w-full border-b border-mc-line flex justify-between"><span className="text-[10px] text-mc-faint -mt-2.5">{formatKsh(maxHourly)}</span></div>
                  <div className="w-full border-b border-mc-line flex justify-between"><span className="text-[10px] text-mc-faint -mt-2.5">{formatKsh((maxHourly * 2) / 3)}</span></div>
                  <div className="w-full border-b border-mc-line flex justify-between"><span className="text-[10px] text-mc-faint -mt-2.5">{formatKsh(maxHourly / 3)}</span></div>
                  <div className="w-full border-b border-mc-line flex justify-between"><span className="text-[10px] text-mc-faint -mt-2.5">0</span></div>
                </div>

                {/* SVG Chart */}
                <svg className="w-full h-56 overflow-visible" fill="none" viewBox="0 0 900 240" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="mpesaGrad" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#00a859" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#00a859" stopOpacity="0.3" />
                    </linearGradient>
                    <linearGradient id="cashGrad" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity="0.3" />
                    </linearGradient>
                    <linearGradient id="otherGrad" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.3" />
                    </linearGradient>
                  </defs>

                  {/* Stacked Hour Bars */}
                  {hourlyData.map((d, i) => {
                    const x = 35 + i * 85
                    const mpesaHeight = (d.mpesa / maxHourly) * 200
                    const cashHeight = (d.cash / maxHourly) * 200
                    const otherHeight = (d.other / maxHourly) * 200
                    const isPeak = d.hour === peakHour.hour && peakHour.total > 0
                    return <HourlyBar key={d.hour} x={x} mpesaHeight={mpesaHeight} cashHeight={cashHeight} otherHeight={otherHeight} isPeak={isPeak} peakLabel={formatKsh(peakHour.total)} />
                  })}
                </svg>

                {/* X-Axis Labels */}
                <div className="flex justify-between text-mc-muted text-[10px] font-medium pt-2 px-6">
                  {hourlyData.map((d) => (
                    <span key={d.hour} className={d.hour === new Date().getHours() ? 'font-bold text-mc-cobalt' : ''}>
                      {d.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Footer Meta Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-4 mt-4 border-t border-mc-line text-mc-muted text-sm">
                <div className="flex flex-wrap items-center gap-4">
                  <span><strong className="text-mc-body">Today:</strong> {stats.count} completed tickets</span>
                  <span><strong className="text-mc-body">Cashier accounts:</strong> {cashierUsers.length}</span>
                  <span><strong className="text-mc-body">Open shift:</strong> {shift ? `#${shift.id}` : 'None'}</span>
                </div>
                <span className="inline-flex items-center gap-1 text-mc-mpesa font-semibold">
                  <span className="w-2 h-2 rounded-full bg-mc-mpesa animate-pulse-dot" />
                  Current till totals
                </span>
              </div>
            </div>

            {/* Category Movement */}
            <div className="xl:col-span-4 bg-white rounded-xl border border-mc-line p-4 lg:p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[18px] font-semibold text-mc-ink">Category Movement</h2>
                <NavLink to="/inventory" className="text-sm text-mc-cobalt hover:underline font-medium">Full Catalog →</NavLink>
              </div>
              <p className="text-sm text-mc-muted mb-5">Today's sales volume ranked by automotive category</p>
              <div className="flex-1 flex flex-col gap-3">
                {categorySales.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-mc-muted text-sm">No sales data today</div>
                ) : (
                  categorySales.map((cat, i) => {
                    const pct = Math.round((cat.revenue / totalCatRevenue) * 100)
                    const colors = [
                      'bg-mc-cobalt',
                      'bg-mc-mpesa',
                      'bg-mc-cobalt-hover',
                      'bg-navy-700',
                      'bg-mc-faint',
                    ]
                    return (
                      <div key={cat.name} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-mc-body flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />
                            {cat.name}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="mc-figure text-[13px]">{formatKsh(cat.revenue)}</span>
                            <span className="text-[11px] text-mc-muted font-bold">{pct}%</span>
                          </div>
                        </div>
                        <div className="w-full bg-mc-canvas h-1.5 rounded-full overflow-hidden">
                          <div className={`${colors[i % colors.length]} h-full rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
              <div className="mt-4 p-3 bg-mc-canvas rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowUpRight size={16} className="text-mc-mpesa" />
                  <span className="text-sm text-mc-body">Top part: <strong className="font-semibold">{topPart?.name ?? 'No sales yet'}</strong></span>
                </div>
                <span className="text-[11px] font-bold text-mc-ink">{topPart ? `${topPart.units} units` : '—'}</span>
              </div>
            </div>
          </div>

          {/* Operational Workspaces Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            {/* Critical Low-Stock & Reorder Alerts */}
            <div className="bg-white rounded-xl border border-mc-line p-4 lg:p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <AlertCircle size={20} className="text-mc-danger" />
                  <h2 className="text-[18px] font-semibold text-mc-ink">Critical Low-Stock & Reorder Alerts</h2>
                </div>
                <Link className="mc-btn" to="/purchasing">
                  <FileText size={14} /> Create Bulk PO
                </Link>
              </div>
              <p className="text-sm text-mc-muted mb-4">Items below minimum shelf threshold requiring immediate purchase orders</p>
              <div className="overflow-x-auto flex-1">
                <table className="w-full">
                  <thead className="table-head">
                    <tr>
                      <th className="rounded-l">Part Name / OEM</th>
                      <th className="text-center">Stock / Min</th>
                      <th>Primary Supplier</th>
                      <th className="text-right">Restock Cost</th>
                      <th className="text-right rounded-r">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStock.slice(0, 8).map((p) => (
                      <tr key={p.id} className="table-row">
                        <td className="py-2.5">
                          <div className="flex flex-col">
                            <span className="font-medium text-mc-body">{p.name}</span>
                            <span className="text-[11px] text-mc-muted font-mono">OEM: {p.partNumber || '—'} · Fit: {p.fitment[0] || 'Not specified'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${p.stock <= 0 ? 'bg-mc-danger-soft text-mc-danger' : 'bg-mc-warn-soft text-mc-warn'}`}>
                            {p.stock} / {p.reorderLevel} pcs
                          </span>
                        </td>
                        <td className="py-2.5">
                          <div className="flex flex-col">
                            <span className="font-medium text-mc-body">{p.supplierId ? supplierNames[p.supplierId] ?? `Supplier #${p.supplierId}` : 'No supplier assigned'}</span>
                            <span className="text-[11px] text-mc-muted">{p.supplierId ? 'Supplier on file' : 'Supplier details needed'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right mc-figure text-[13px]">
                          {formatKsh((p.reorderLevel - p.stock) * p.cost)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Link className="mc-btn-primary text-[11px] px-2 py-1" to="/purchasing">
                            + PO
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {lowStock.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-sm text-mc-muted">No active products are at or below their reorder level.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="pt-3 mt-3 border-t border-mc-line flex items-center justify-between text-mc-muted text-sm">
                <span>Showing {Math.min(8, lowStock.length)} of {lowStock.length} alert lines</span>
                <NavLink to="/inventory?view=lowstock" className="text-mc-cobalt hover:underline font-semibold">View All Low-Stock SKUs →</NavLink>
              </div>
            </div>

            {/* Recent Counter Transactions */}
            <div className="bg-white rounded-xl border border-mc-line p-4 lg:p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Receipt size={20} className="text-mc-cobalt" />
                  <h2 className="text-[18px] font-semibold text-mc-ink">Recent Counter Transactions</h2>
                </div>
                <NavLink to="/sales" className="mc-btn text-[11px]">All Invoices</NavLink>
              </div>
              <p className="text-sm text-mc-muted mb-4">Recorded point of sale transactions from tills</p>
              <div className="overflow-x-auto flex-1">
                <table className="w-full">
                  <thead className="table-head">
                    <tr>
                      <th className="rounded-l">Receipt · Time</th>
                      <th>Customer / Fleet</th>
                      <th className="text-center">Items</th>
                      <th className="text-right">Amount</th>
                      <th className="text-center">Tender</th>
                      <th className="text-right rounded-r">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTransactions.map((s) => {
                      const items = s.lines.reduce((n, l) => n + Math.abs(l.qty), 0)
                      const primaryMethod = s.payments[0]?.method || 'cash'
                      const methodLabels = [...new Set(s.payments.map((payment) => METHOD_LABEL[payment.method]))]
                      return (
                        <tr key={s.id} className="table-row">
                          <td className="py-2.5">
                            <div className="flex flex-col">
                              <span className="font-medium text-mc-body">{s.receiptNo}</span>
                              <span className="text-[11px] text-mc-muted">{new Date(s.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })} · Shift {s.shiftId || '—'}</span>
                            </div>
                          </td>
                          <td className="py-2.5">
                            <div className="flex flex-col">
                              <span className="font-medium text-mc-body">{getCustomerName(s.customerId)}</span>
                              <span className="text-[11px] text-mc-muted">{getCustomerAccount(s.customerId)}</span>
                            </div>
                          </td>
                          <td className="py-2.5 text-center mc-figure text-[13px]">{items}</td>
                          <td className="py-2.5 text-right mc-figure text-[13px] font-bold">{formatKsh(s.total)}</td>
                          <td className="py-2.5 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${primaryMethod === 'mpesa' ? 'bg-mc-mpesa-soft text-mc-mpesa-hover' :
                               primaryMethod === 'cash' ? 'bg-green-100 text-green-700' :
                               primaryMethod === 'card' ? 'bg-violet-100 text-violet-700' :
                               'bg-amber-100 text-amber-700'}`}>
                              {primaryMethod === 'mpesa' && <span className="w-1.5 h-1.5 rounded-full bg-mc-mpesa animate-pulse-dot" />}
                              {methodLabels.join(' + ')}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <NavLink className="inline-flex rounded p-1 text-mc-muted transition hover:bg-mc-canvas hover:text-mc-body" title="Open sales" to="/sales">
                              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="6 9 6 2 18 2 18 9" />
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                                <rect x="6" y="14" width="12" height="8" />
                              </svg>
                            </NavLink>
                          </td>
                        </tr>
                      )
                    })}
                    {recentTransactions.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-sm text-mc-muted">No transactions recorded today.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="pt-3 mt-3 border-t border-mc-line flex items-center justify-between text-mc-muted text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-mc-mpesa animate-pulse-dot" />
                  <span>{recentTransactions.length} recent transactions shown · {stats.count} tickets today</span>
                </div>
                <NavLink to="/sell" className="text-mc-cobalt hover:underline font-semibold">Open Full POS Register →</NavLink>
              </div>
            </div>
          </div>

          {/* Quick Operational Shortcuts Bar */}
          <div className="bg-mc-canvas border border-mc-line rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-mc-body font-medium">
              <span className="text-mc-cobalt text-lg">⚡</span>
              <span className="font-semibold">Register Actions:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/shift" className="mc-btn-primary flex items-center gap-1.5 px-4 py-2">
                <Receipt size={18} /> End of Day Till Count (Z-Report)
              </Link>
              <Link to="/shift" className="mc-btn flex items-center gap-1.5 px-4 py-2">
                <RotateCcw size={18} /> Open Shift Cash Drawer
              </Link>
              <button className="mc-btn flex items-center gap-1.5 px-4 py-2" onClick={() => searchRef.current?.focus()} type="button">
                <Search size={18} /> Price Lookup Scanner (F4)
              </button>
              <Link to="/customers" className="mc-btn flex items-center gap-1.5 px-4 py-2">
                <Group size={18} /> Customers & Accounts
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
