// Owner / manager portal chrome, after the Stitch "Store Executive Dashboard"
// design: light grouped sidebar with the shop + sync card, and a top bar with
// part search (Ctrl+K), New Sale (F1) and live sync status.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bell,
  Bike,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  Lock,
  Mail,
  Menu,
  Package,
  Plus,
  Receipt,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  TrendingUp,
  Truck,
  TriangleAlert,
  UserCog,
  UserRound,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { useSession, type Permission } from '../session'
import { moneyShort } from '../lib/money'
import { SyncChip, SyncLine } from './SyncStatus'

interface Item {
  to: string
  label: string
  icon: typeof Package
  perm?: Permission
  badge?: 'f1' | 'owed' | 'jobs' | 'low'
  /** Custom active test (for links that share a path, like Low Stock Alerts). */
  match?: (path: string, search: string) => boolean
}

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: 'Operations',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/sell', label: 'Point of Sale', icon: ShoppingCart, badge: 'f1' },
      { to: '/sales', label: 'Sales & Invoices', icon: Receipt },
      { to: '/customers', label: 'Customer Credit', icon: Users, badge: 'owed' },
      { to: '/service', label: 'Service Jobs', icon: Wrench, badge: 'jobs' },
    ],
  },
  {
    label: 'Inventory & Catalog',
    items: [
      { to: '/inventory', label: 'Products & Spares', icon: Package, perm: 'inventory', match: (p, s) => p === '/inventory' && !s.includes('view=lowstock') },
      { to: '/fitment', label: 'Vehicle Fit Matrix', icon: Bike, perm: 'inventory' },
      { to: '/stock', label: 'Stock Movements', icon: ClipboardList, perm: 'inventory' },
      { to: '/inventory?view=lowstock', label: 'Low Stock Alerts', icon: TriangleAlert, perm: 'inventory', badge: 'low', match: (p, s) => p === '/inventory' && s.includes('view=lowstock') },
    ],
  },
  {
    label: 'Purchases & Vendors',
    items: [{ to: '/purchasing', label: 'Suppliers & Orders', icon: Truck, perm: 'purchasing' }],
  },
  {
    label: 'Financials',
    items: [
      { to: '/reports', label: 'Financial Reports', icon: TrendingUp, perm: 'reports' },
      { to: '/shift', label: 'Shift & Cash-up', icon: Wallet },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/staff', label: 'Staff & Roles', icon: UserCog, perm: 'users' },
      { to: '/logs', label: 'Activity Log', icon: ScrollText, perm: 'logs' },
      { to: '/messages', label: 'Messages', icon: Mail },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, perm: 'settings' },
    ],
  },
]

const TITLES: [RegExp, string][] = [
  [/^\/dashboard/, 'Dashboard'],
  [/^\/sell/, 'Point of Sale'],
  [/^\/sales/, 'Sales & Invoices'],
  [/^\/customers/, 'Customer Credit'],
  [/^\/service/, 'Service Jobs'],
  [/^\/inventory/, 'Products & Spares'],
  [/^\/fitment/, 'Vehicle Fit Matrix'],
  [/^\/stock/, 'Stock Movements'],
  [/^\/purchasing/, 'Suppliers & Orders'],
  [/^\/reports/, 'Financial Reports'],
  [/^\/shift/, 'Shift & Cash-up'],
  [/^\/staff/, 'Staff & Roles'],
  [/^\/logs/, 'Activity Log'],
  [/^\/notifications/, 'Notifications'],
  [/^\/messages/, 'Messages'],
  [/^\/settings/, 'Settings'],
  [/^\/profile/, 'My Profile'],
]

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export default function AdminShell({ children }: { children: ReactNode }) {
  const { user, shift, lock, can } = useSession()
  const settings = useSettings()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [q, setQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const counts = useLiveQuery(
    async () => {
      const products = await db.products.filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel).count()
      const owed = (await db.customers.filter((c) => c.balance > 0).toArray()).reduce((s, c) => s + c.balance, 0)
      const jobs = await db.jobs.where('status').noneOf(['collected']).count()
      return { low: products, owed, jobs }
    },
    [],
    { low: 0, owed: 0, jobs: 0 },
  )

  // Close the drawer and menus on navigation.
  useEffect(() => {
    setNavOpen(false)
    setMenuOpen(false)
  }, [pathname, search])

  // F1 new sale · F3 add part · Ctrl/⌘+K search parts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        navigate('/sell')
      } else if (e.key === 'F3' && can('inventory')) {
        e.preventDefault()
        navigate('/inventory?new=1')
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !pathname.startsWith('/sell')) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, can, pathname])

  if (!user) return null
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? ''
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) })).filter((g) => g.items.length)

  const badge = (b?: Item['badge']) => {
    if (b === 'f1') return <span className="rounded bg-adm-blue px-1.5 py-0.5 text-[10px] font-bold text-white">F1</span>
    if (b === 'owed' && counts.owed > 0) return <span className="rounded bg-adm-highest px-1.5 py-0.5 text-[10px] font-bold text-adm-ink">{settings.currency} {moneyShort(counts.owed)}</span>
    if (b === 'jobs' && counts.jobs > 0) return <span className="rounded bg-adm-highest px-1.5 py-0.5 text-[10px] font-bold text-adm-ink">{counts.jobs}</span>
    if (b === 'low' && counts.low > 0) return <span className="rounded bg-adm-red px-1.5 py-0.5 text-[10px] font-bold text-white">{counts.low}</span>
    return null
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const term = q.trim()
    if (!term) return
    navigate(can('inventory') ? `/inventory?q=${encodeURIComponent(term)}` : `/products?q=${encodeURIComponent(term)}`)
    setQ('')
    searchRef.current?.blur()
  }

  return (
    <div className="adm flex h-full bg-adm-surface text-adm-ink">
      {navOpen && <button type="button" aria-label="Close menu" onClick={() => setNavOpen(false)} className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px] lg:hidden" />}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-adm-low shadow-[0_1px_8px_rgba(0,0,0,0.06)] transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 bg-white px-4 py-4">
          <Link to="/dashboard" className="flex min-w-0 items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-9 w-9 shrink-0 rounded-lg" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold leading-tight tracking-tight text-adm-primary">{settings.shopName}</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-adm-muted">Enterprise POS</span>
            </span>
          </Link>
          <button type="button" onClick={() => setNavOpen(false)} className="rounded p-1 text-adm-muted hover:bg-adm-high lg:hidden" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <div className="bg-adm-mid px-3 py-2.5">
          <div className="rounded-md bg-white px-3 py-2">
            <div className="truncate text-xs font-bold text-adm-ink">{settings.shopName}</div>
            <div className="truncate text-[11px] text-adm-muted">{settings.address || 'Add the address in Settings'}</div>
            <SyncLine />
          </div>
        </div>

        <nav className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-adm-muted">{g.label}</div>
              <div className="space-y-0.5">
                {g.items.map((item) => {
                  const active = item.match ? item.match(pathname, search) : pathname.startsWith(item.to)
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13px] transition ${
                        active ? 'bg-adm-navy font-bold text-white' : 'font-medium text-adm-muted hover:bg-adm-high hover:text-adm-ink'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <item.icon size={17} className={`shrink-0 ${active ? 'text-adm-navy-ink' : ''}`} />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {badge(item.badge)}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-adm-high bg-white px-4 py-3">
          <Link to="/profile" className="flex min-w-0 items-center gap-2.5">
            {user.image ? (
              <img src={user.image} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-adm-navy text-xs font-bold text-white">{initials(user.name)}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold">{user.name}</span>
              <span className="block truncate text-[11px] capitalize text-adm-muted">
                {user.role} · {shift ? 'Shift open' : 'No shift'}
              </span>
            </span>
          </Link>
          <button type="button" onClick={lock} title="Lock the till" className="rounded-lg p-2 text-adm-muted transition hover:bg-adm-high hover:text-adm-ink">
            <Lock size={16} />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-adm-high bg-white px-3 sm:px-5">
          <button type="button" onClick={() => setNavOpen(true)} className="rounded-lg p-2 text-adm-muted hover:bg-adm-low lg:hidden" aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="hidden min-w-0 shrink-0 items-center gap-1.5 text-sm md:flex">
            <span className="max-w-[10rem] truncate text-adm-muted">{settings.shopName}</span>
            <span className="text-adm-faint">›</span>
            <span className="font-semibold">{title}</span>
          </div>

          <form onSubmit={submitSearch} className="relative mx-auto w-full max-w-md min-w-0">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-adm-faint" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search part no., SKU, OEM, barcode…"
              className="h-10 w-full rounded-lg border border-adm-high bg-adm-low pl-9 pr-16 text-sm outline-none transition placeholder:text-adm-faint focus:border-adm-blue focus:bg-white focus:ring-2 focus:ring-adm-blue/15"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-adm-line bg-white px-1.5 py-0.5 text-[10px] font-semibold text-adm-muted sm:block">Ctrl+K</kbd>
          </form>

          <Link
            to="/sell"
            className="hidden h-10 shrink-0 items-center gap-1.5 rounded-lg bg-adm-blue px-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 sm:flex"
          >
            <Plus size={16} /> New Sale <span className="text-[11px] font-semibold opacity-80">(F1)</span>
          </Link>
          <SyncChip />
          <Link to="/notifications" className="relative rounded-lg p-2 text-adm-muted transition hover:bg-adm-low hover:text-adm-ink" title="Notifications">
            <Bell size={18} />
            {counts.low > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-adm-red px-1 text-[9px] font-bold text-white">{counts.low}</span>}
          </Link>
          <div className="relative hidden sm:block">
            <button type="button" onClick={() => setMenuOpen((m) => !m)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-adm-low">
              {user.image ? (
                <img src={user.image} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded-full bg-adm-navy text-xs font-bold text-white">{initials(user.name)}</span>
              )}
              <span className="hidden text-left xl:block">
                <span className="block text-xs font-bold leading-tight">{user.name}</span>
                <span className="block text-[11px] capitalize leading-tight text-adm-muted">{user.role}</span>
              </span>
              <ChevronDown size={14} className="text-adm-muted" />
            </button>
            {menuOpen && (
              <>
                <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-adm-high bg-white py-1 shadow-lg">
                  <Link to="/profile" className="flex items-center gap-2 px-3 py-2 text-sm text-adm-muted hover:bg-adm-low hover:text-adm-ink">
                    <UserRound size={15} /> My profile
                  </Link>
                  <button type="button" onClick={lock} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-adm-muted hover:bg-adm-low hover:text-adm-ink">
                    <Lock size={15} /> Lock till
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-mist">{children}</main>
      </div>
    </div>
  )
}
