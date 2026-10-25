import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import {
  Bell,
  BarChart3,
  Boxes,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Package,
  Receipt,
  ScrollText,
  Settings as SettingsIcon,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  UserRound,
  Wallet,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useSession, type Permission } from './session'
import { useSettings } from './db/settings'
import LoginPage, { PinChangeGate } from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import StaffDashboardPage from './pages/StaffDashboardPage'
import StaffProductsPage from './pages/StaffProductsPage'
import CustomerDisplayPage from './pages/CustomerDisplayPage'
import SellPage from './pages/SellPage'
import SalesPage from './pages/SalesPage'
import InventoryPage from './pages/InventoryPage'
import PurchasingPage from './pages/PurchasingPage'
import CustomersPage from './pages/CustomersPage'
import ServicePage from './pages/ServicePage'
import ReportsPage from './pages/ReportsPage'
import ShiftPage from './pages/ShiftPage'
import SettingsPage from './pages/SettingsPage'
import NotificationsPage from './pages/NotificationsPage'
import MessagesPage from './pages/MessagesPage'
import StaffPage from './pages/StaffPage'
import LogsPage from './pages/LogsPage'
import ProfilePage from './pages/ProfilePage'

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
    label: 'Main Menu',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, iconClass: 'text-orange-500' },
      { to: '/sell', label: 'Sell', icon: ShoppingCart, iconClass: 'text-emerald-500' },
      { to: '/sales', label: 'Sales', icon: Receipt, iconClass: 'text-sky-500' },
      { to: '/service', label: 'Service', icon: Wrench, iconClass: 'text-violet-500' },
      { to: '/notifications', label: 'Notifications', icon: Bell, iconClass: 'text-amber-500' },
      { to: '/messages', label: 'Messages', icon: Mail, iconClass: 'text-sky-500' },
    ],
  },
  {
    label: 'Shop',
    items: [
      { to: '/products', label: 'Products', icon: Package, iconClass: 'text-emerald-400' },
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
      { to: '/staff', label: 'Staff', icon: UserCog, perm: 'users', iconClass: 'text-rose-400' },
      { to: '/logs', label: 'Logs', icon: ScrollText, perm: 'logs', iconClass: 'text-lime-400' },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, perm: 'settings', iconClass: 'text-cyan-400' },
    ],
  },
]

const TOP_TABS: { to: string; label: string; perm?: Permission }[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/sell', label: 'Sell' },
  { to: '/sales', label: 'Sales' },
  { to: '/products', label: 'Products' },
  { to: '/inventory', label: 'Inventory', perm: 'inventory' },
  { to: '/reports', label: 'Reports', perm: 'reports' },
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
  const { user, shift, lock, can } = useSession()
  const settings = useSettings()
  const online = useOnline()
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

  if (!user) return <LoginPage />
  if (user.mustChangePin) return <PinChangeGate user={user} />

  const isOwner = can('users')
  const isCashier = user.role === 'cashier'
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => {
      if (isCashier && n.to === '/sell') return false
      if (n.to === '/products' && isOwner) return false
      if (isOwner) return true
      if (!n.perm) return ['/dashboard', '/sell', '/sales', '/products', '/inventory', '/notifications'].includes(n.to)
      return can(n.perm)
    }),
  })).filter((g) => g.items.length > 0)
  const topTabs = isCashier
    ? TOP_TABS.filter((tab) => tab.to !== '/sell')
    : TOP_TABS.filter((tab) => tab.to !== '/products')

  // Staff land on the checkout workspace, not the owner's analytics dashboard.
  const navLabel = (label: string) => (label === 'Dashboard' && !isOwner ? 'Checkout' : label)

  // Card colors per top-bar tab, matching the register chrome.
  const TAB_COLORS: Record<string, { border: string; bg: string }> = {
    '/dashboard': { border: '#5c8f31', bg: '#76b043' },
    '/sales': { border: '#2e8fc4', bg: '#4a9fd8' },
    '/products': { border: '#cc7010', bg: '#f2891d' },
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cashier navigation follows the white, teal and green register theme. */}
      {/* Cashier top bar mirrors the admin sidebar chrome; both sit on the same dark rail. */}
      <header className={`relative flex h-20 shrink-0 items-stretch ${isCashier ? 'border-b border-black/30 bg-[#2e353b]' : 'bg-[#2f63a8]'}`}>
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Open menu"
          className={`flex shrink-0 items-center px-2 transition active:scale-95 sm:hidden text-white/90 hover:bg-white/15`}
        >
          <Menu size={22} />
        </button>

        <div className={`hidden shrink-0 items-center justify-center px-4 sm:flex ${isCashier ? 'bg-[#2e353b] sm:w-72' : 'bg-white sm:w-56 lg:w-60'}`}>
          <span
            className={`truncate text-2xl font-medium tracking-normal ${isCashier ? 'text-white' : 'text-slate-900'}`}
            style={{ fontFamily: '"Poppins", "Inter", sans-serif' }}
          >
            {settings.shopName}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1 px-2">
          <nav className="hidden h-full min-w-0 flex-1 items-center justify-end gap-3 overflow-x-auto sm:flex">
            {topTabs.filter((t) => !t.perm || can(t.perm)).map((tab) => {
              const color = TAB_COLORS[tab.to]
              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={({ isActive }) =>
                    `flex h-11 shrink-0 items-center rounded-[4px] border px-5 text-sm font-semibold transition ${
                      color
                        ? 'text-white shadow-sm hover:brightness-105'
                        : isActive
                          ? 'border-[#2e8fc4] bg-[#4a9fd8] text-white shadow-sm'
                          : 'border-[#b3b9bd] bg-[#f2f4f5] text-[#333b3f] hover:bg-[#e6eaec]'
                    }`
                  }
                  style={color ? { borderColor: color.border, background: color.bg } : undefined}
                >
                  {navLabel(tab.label)}
                </NavLink>
              )
            })}
          </nav>

          <span className={`min-w-0 flex-1 truncate text-center text-base font-bold tracking-tight text-white sm:hidden`}>
            {settings.shopName}
          </span>

          <div className="flex shrink-0 items-center gap-1">
            <span className={`mr-1 hidden items-center gap-1.5 text-sm text-white/80 sm:flex`}>
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {online ? 'Online' : 'Offline'}
            </span>
            <NavLink
              to="/shift"
              className={`mr-1 hidden text-sm font-medium md:inline ${shift ? 'text-white' : 'text-red-300'}`}
            >
              {shift
                ? `Shift · ${new Date(shift.openedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`
                : 'No shift'}
            </NavLink>
            <NavLink to="/notifications" className={`relative hidden rounded-lg p-2 transition text-white/80 hover:bg-white/15 hover:text-white sm:block`} title="Notifications">
              <Bell size={18} />
            </NavLink>
            <NavLink to="/messages" className={`hidden rounded-lg p-2 text-white/80 hover:bg-white/15 hover:text-white sm:block`} title="Messages">
              <Mail size={18} />
            </NavLink>
            {can('settings') && (
              <NavLink
                to="/settings"
                className={`hidden rounded-lg p-2 text-white/80 transition hover:bg-white/15 hover:text-white sm:block`}
                title="Settings"
              >
                <SettingsIcon size={18} />
              </NavLink>
            )}

            {/* User account dropdown */}
            <div className={`ml-1 flex items-center sm:border-l sm:border-white/25 sm:pl-3`}>
              <button
                type="button"
                onClick={() => setMenuOpen((m) => !m)}
                className={`flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-white/15`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm ring-2 ring-white/40`}>
                  <img src={user.image ?? 'avatar.svg'} alt={user.name} className="h-full w-full object-cover" />
                </span>
                <span className={`hidden text-sm font-semibold text-white xl:block`}>{user.name}</span>
                <ChevronDown size={15} className={`text-white/70 transition ${menuOpen ? 'rotate-180' : ''}`} />
              </button>
              {menuOpen && (
                <>
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-2 top-full z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    <div className="border-b border-slate-100 px-4 py-2.5">
                      <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
                      <div className="text-xs capitalize text-slate-500">{user.role}</div>
                    </div>
                    <Link
                      to="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                    >
                      <UserRound size={15} />
                      My profile
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        lock()
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                    >
                      <LogOut size={15} />
                      Lock
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {navOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-[2px] sm:hidden"
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* Dark sidebar — static rail on desktop, slide-in drawer on phones */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col ${isCashier ? 'bg-register-teal' : 'bg-[#2e353b]'} shadow-2xl transition-transform duration-200 ${
            isCashier
              ? `${navOpen ? 'translate-x-0' : '-translate-x-full'} sm:hidden`
              : `${navOpen ? 'translate-x-0' : '-translate-x-full'} sm:static sm:z-auto sm:w-56 sm:translate-x-0 sm:shadow-none lg:w-60`
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 sm:hidden">
            <span className="truncate text-sm font-bold text-white">{settings.shopName}</span>
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close menu"
              className="-mr-1 shrink-0 rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white active:scale-95"
            >
              <X size={18} />
            </button>
          </div>
          <nav className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-2">
            {visibleGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="bg-black/25 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {group.label}
                </div>
                {group.items.map(({ to, label, icon: Icon, iconClass }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setNavOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition ${
                        isActive ? 'bg-[#3c454d] text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`
                    }
                  >
                    <Icon size={17} className={`shrink-0 ${iconClass}`} />
                    {navLabel(label)}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-mist">
          <Routes>
            <Route path="/dashboard" element={can('users') ? <DashboardPage /> : <StaffDashboardPage />} />
            <Route path="/sell" element={isCashier ? <StaffDashboardPage /> : <SellPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/products" element={<StaffProductsPage />} />
            <Route path="/display" element={<CustomerDisplayPage />} />
            <Route path="/service" element={<ServicePage />} />
            <Route path="/inventory" element={<Guard perm="inventory"><InventoryPage /></Guard>} />
            <Route path="/purchasing" element={<Guard perm="purchasing"><PurchasingPage /></Guard>} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/reports" element={<Guard perm="reports"><ReportsPage /></Guard>} />
            <Route path="/shift" element={<ShiftPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/staff" element={<Guard perm="users"><StaffPage /></Guard>} />
            <Route path="/logs" element={<Guard perm="logs"><LogsPage /></Guard>} />
            <Route path="/settings" element={<Guard perm="settings"><SettingsPage /></Guard>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
