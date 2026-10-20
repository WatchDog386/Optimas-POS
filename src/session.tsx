import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db/db'
import type { Role, Shift, User } from './db/types'

interface SessionValue {
  user: User | null
  shift: Shift | undefined
  login: (pin: string) => Promise<boolean>
  logout: () => void
  can: (action: Permission) => boolean
}

export type Permission = 'refund' | 'discount' | 'inventory' | 'reports' | 'settings' | 'purchasing'

const PERMS: Record<Role, Permission[]> = {
  owner: ['refund', 'discount', 'inventory', 'reports', 'settings', 'purchasing'],
  manager: ['refund', 'discount', 'inventory', 'reports', 'purchasing'],
  cashier: ['discount'],
}

export const PIN_LENGTH = 4

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const shift = useLiveQuery(() => db.shifts.filter((s) => !s.closedAt).last(), [])

  const login = useCallback(async (pin: string) => {
    const u = await db.users.where('pin').equals(pin).filter((x) => x.active).first()
    if (u) setUser(u)
    return !!u
  }, [])

  const logout = useCallback(() => setUser(null), [])
  const can = useCallback((a: Permission) => !!user && PERMS[user.role].includes(a), [user])

  return <SessionContext.Provider value={{ user, shift, login, logout, can }}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
