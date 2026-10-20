import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  Bell,
  BarChart3,
  Boxes,
  LayoutDashboard,
  LogOut,
  Mail,
  Receipt,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useSession, type Permission } from './session'
import { useSettings } from './db/settings'
import LoginPage from './pages/LoginPage'
import LoadingScreen from './components/LoadingScreen'
import DashboardPage from './pages/DashboardPage'
import SellPage from './pages/SellPage'
import SalesPage from './pages/SalesPage'
import InventoryPage from './pages/InventoryPage'
import PurchasingPage from './pages/PurchasingPage'
import CustomersPage from './pages/CustomersPage'
import ServicePage from './pages/ServicePage'
import ReportsPage from './pages/ReportsPage'
import ShiftPage from './pages/ShiftPage'
import SettingsPage from './pages/SettingsPage'

interface NavItem {
  to: string
  label: string
  icon: typeof ShoppingCart
  perm?: Permission
  iconClass: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, iconClass: 'text-orange-500' }],
  },
  {
    label: 'Counter',
    items: [
      { to: '/sell', label: 'Sell', icon: ShoppingCart, iconClass: 'text-emerald-500' },
      { to: '/sales', label: 'Sales', icon: Receipt, iconClass: 'text-sky-500' },
      { to: '/service', label: 'Service', icon: Wrench, iconClass: 'text-violet-500' },
    ],
  },
  {
    label: 'Shop',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Boxes, perm: 'inventory', iconClass: 'text-amber-500' },
      { to: '/purchasing', label: 'Purchasing', icon: Truck, perm: 'purchasing', iconClass: 'text-orange-500' },
      { to: '/customers', label: 'Customers', icon: Users, iconClass: 'text-pink-500' },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports', iconClass: 'text-indigo-500' },
      { to: '/shift', label: 'Shift', icon: Wallet, iconClass: 'text-teal-500' },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, perm: 'settings', iconClass: 'text-slate-500' },
    ],
  },
]

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function Guard({ perm, children }: { perm?: Permission; children: ReactNode }) {
  const { can } = useSession()
  if (perm && !can(perm)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  const { user, shift, logout, can } = useSession()
  const settings = useSettings()
  const online = useOnline()
  const location = useLocation()
  const [booting, setBooting] = useState(false)

  // Brief loading screen after a successful login, before the dashboard shell.
  useEffect(() => {
    if (!user) return
    setBooting(true)
    const t = setTimeout(() => setBooting(false), 1500)
    return () => clearTimeout(t)
  }, [user])

  if (!user) return <LoginPage />
  if (booting) return <LoadingScreen title={`Welcome back, ${user.name.split(' ')[0]}`} />

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => !n.perm || can(n.perm)),
  })).filter((g) => g.items.length > 0)
  const visibleItems = visibleGroups.flatMap((g) => g.items)
  const active = visibleItems.find((n) => location.pathname.startsWith(n.to))

  return (
    <div className="flex h-full">
      {/* Dark teal icon rail — matches TrioPay-style chrome */}
      <aside className="hidden w-14 shrink-0 flex-col items-center bg-navy-950 py-3 sm:flex">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-base font-extrabold text-white shadow-md">
          O
        </div>
        <nav className="flex flex-1 flex-col items-center gap-2">
          {visibleItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                `flex h-10 w-10 items-center justify-center rounded-xl text-white transition ${
                  isActive ? 'bg-brand-500 shadow-md ring-2 ring-white/30' : 'bg-white/10 hover:bg-white/20'
                }`
              }
            >
              <Icon size={18} className="text-white" />
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          title="Lock / switch user"
          className="mt-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-white ring-2 ring-white/30 hover:bg-brand-600"
        >
          {initials}
        </button>
      </aside>

      {/* Dark teal menu panel — matches TrioPay-style chrome */}
      <aside className="hidden w-60 shrink-0 flex-col bg-navy-950 lg:flex">
        <div className="border-b border-white/10 px-4 py-3.5">
          <div className="truncate text-lg font-bold text-white">{settings.shopName}</div>
          <div className="text-sm font-medium capitalize text-white/60">{user.role}</div>
        </div>

        <div className="px-3 pt-3">
          <div className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2.5">
            <span className="text-xs font-bold uppercase tracking-widest text-white/70">Today</span>
            <span className="flex items-center gap-1 text-white/50">
              <button type="button" className="rounded p-0.5 hover:bg-white/10" aria-label="Previous day">‹</button>
              <button type="button" className="rounded p-0.5 hover:bg-white/10" aria-label="Next day">›</button>
            </span>
          </div>
        </div>

        {active && (
          <div className="px-3 pb-1 pt-3">
            <NavLink
              to={active.to}
              className="flex items-center gap-3 rounded-xl border-2 border-brand-400/50 bg-white/10 px-3 py-3 text-lg font-bold text-white shadow-sm"
            >
              <active.icon size={20} className={active.iconClass} />
              {active.label}
            </NavLink>
          </div>
        )}

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/40">
                {group.label}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.items.map(({ to, label, icon: Icon, iconClass }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-medium transition ${
                        isActive
                          ? 'bg-brand-500 text-white shadow-sm'
                          : 'text-white/80 hover:bg-white/10 hover:text-white'
                      }`
                    }
                  >
                    <Icon size={20} className={`shrink-0 ${iconClass}`} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-base font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut size={20} className="text-white/50" />
            Lock
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-navy-950 px-4 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm text-white/80 ring-1 ring-white/20 md:flex">
              <Search size={15} />
              <span>Search…</span>
            </div>
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <span className="truncate text-base font-bold text-white">{settings.shopName}</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <span className="mr-2 hidden items-center gap-1.5 text-sm text-white/70 sm:flex">
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-brand-400' : 'bg-amber-400'}`} />
              {online ? 'Online' : 'Offline'}
            </span>
            <NavLink
              to="/shift"
              className={`mr-2 hidden text-sm font-medium md:inline ${shift ? 'text-brand-400' : 'text-red-300'}`}
            >
              {shift
                ? `Shift · ${new Date(shift.openedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`
                : 'No shift'}
            </NavLink>
            <button className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" title="Notifications" type="button">
              <Bell size={18} />
            </button>
            <button className="hidden rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white sm:block" title="Messages" type="button">
              <Mail size={18} />
            </button>
            {can('settings') && (
              <NavLink to="/settings" className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" title="Settings">
                <SettingsIcon size={18} />
              </NavLink>
            )}
            <div className="ml-2 flex items-center gap-2.5 border-l border-white/15 pl-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-[12px] font-bold text-white shadow-sm">
                {initials}
              </div>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-semibold text-white">{user.name}</div>
                <div className="text-xs capitalize text-white/60">{user.role}</div>
              </div>
              <span className="text-sm text-white/50">▾</span>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto bg-[#f5f8fc]">
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/sell" element={<SellPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/service" element={<ServicePage />} />
            <Route path="/inventory" element={<Guard perm="inventory"><InventoryPage /></Guard>} />
            <Route path="/purchasing" element={<Guard perm="purchasing"><PurchasingPage /></Guard>} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/reports" element={<Guard perm="reports"><ReportsPage /></Guard>} />
            <Route path="/shift" element={<ShiftPage />} />
            <Route path="/settings" element={<Guard perm="settings"><SettingsPage /></Guard>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
