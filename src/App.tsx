import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  ClipboardList,
  LogOut,
  Receipt,
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
import SellPage from './pages/SellPage'
import SalesPage from './pages/SalesPage'
import InventoryPage from './pages/InventoryPage'
import PurchasingPage from './pages/PurchasingPage'
import CustomersPage from './pages/CustomersPage'
import ServicePage from './pages/ServicePage'
import ReportsPage from './pages/ReportsPage'
import ShiftPage from './pages/ShiftPage'
import SettingsPage from './pages/SettingsPage'

const NAV: { to: string; label: string; icon: typeof ShoppingCart; perm?: Permission }[] = [
  { to: '/sell', label: 'Sell', icon: ShoppingCart },
  { to: '/sales', label: 'Sales', icon: Receipt },
  { to: '/service', label: 'Service', icon: Wrench },
  { to: '/inventory', label: 'Inventory', icon: Boxes, perm: 'inventory' },
  { to: '/purchasing', label: 'Purchasing', icon: Truck, perm: 'purchasing' },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports' },
  { to: '/shift', label: 'Shift', icon: Wallet },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, perm: 'settings' },
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
  if (perm && !can(perm)) return <Navigate to="/sell" replace />
  return <>{children}</>
}

export default function App() {
  const { user, shift, logout, can } = useSession()
  const settings = useSettings()
  const online = useOnline()

  if (!user) return <LoginPage />

  return (
    <div className="flex h-full">
      <aside className="flex w-20 shrink-0 flex-col items-center bg-slate-950 py-3 text-slate-400 lg:w-24">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-lg font-black text-slate-950">
          O
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.filter((n) => !n.perm || can(n.perm)).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex w-16 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium lg:w-20 ${
                  isActive ? 'bg-slate-800 text-brand-400' : 'hover:bg-slate-900 hover:text-white'
                }`
              }
            >
              <Icon size={22} />
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="flex w-16 flex-col items-center gap-1 rounded-xl py-2 text-[11px] hover:bg-slate-900 hover:text-white"
          title="Lock / switch user"
        >
          <LogOut size={22} />
          Lock
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <ClipboardList size={16} className="text-slate-400" />
            {settings.shopName}
          </div>
          <div className="flex items-center gap-4 text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {online ? 'Online' : 'Offline – sales still work'}
            </span>
            <NavLink to="/shift" className={shift ? 'text-emerald-700' : 'font-semibold text-red-600'}>
              {shift ? `Shift open since ${new Date(shift.openedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : 'No shift open'}
            </NavLink>
            <span className="font-medium text-slate-700">
              {user.name} · <span className="capitalize">{user.role}</span>
            </span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/sell" element={<SellPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/service" element={<ServicePage />} />
            <Route path="/inventory" element={<Guard perm="inventory"><InventoryPage /></Guard>} />
            <Route path="/purchasing" element={<Guard perm="purchasing"><PurchasingPage /></Guard>} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/reports" element={<Guard perm="reports"><ReportsPage /></Guard>} />
            <Route path="/shift" element={<ShiftPage />} />
            <Route path="/settings" element={<Guard perm="settings"><SettingsPage /></Guard>} />
            <Route path="*" element={<Navigate to="/sell" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
