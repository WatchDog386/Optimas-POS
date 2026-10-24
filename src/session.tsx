import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db/db'
import { logActivity } from './db/logs'
import type { Role, Shift, User } from './db/types'

interface SessionValue {
  user: User | null
  shift: Shift | undefined
  login: (pin: string) => Promise<boolean>
  /** Lock the till: signs the user out and returns to the sign-in page. */
  lock: () => void
  can: (action: Permission) => boolean
}

export type Permission = 'refund' | 'discount' | 'inventory' | 'reports' | 'settings' | 'purchasing' | 'users' | 'logs'

export const PERMS: Record<Role, Permission[]> = {
  owner: ['refund', 'discount', 'inventory', 'reports', 'settings', 'purchasing', 'users', 'logs'],
  manager: ['refund', 'discount', 'inventory', 'reports', 'purchasing', 'logs'],
  cashier: ['discount'],
}

export const PIN_LENGTH = 4

const SessionContext = createContext<SessionValue | null>(null)
export function SessionProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const shift = useLiveQuery(() => db.shifts.filter((s) => !s.closedAt).last(), [])
  // Keep the signed-in user live so profile edits (name, photo) show everywhere.
  const liveUser = useLiveQuery(
    () => (authUser?.id ? db.users.get(authUser.id) : undefined),
    [authUser?.id],
  )
  const user = liveUser ?? authUser

  const login = useCallback(async (pin: string) => {
    const u = await db.users.where('pin').equals(pin).filter((x) => x.active).first()
    if (u) {
      setAuthUser(u)
      await logActivity('auth', 'Signed in', { userId: u.id, userName: u.name })
    }
    return !!u
  }, [])

  const lock = useCallback(() => {
    if (!user) return
    void logActivity('auth', 'Till locked', { userId: user.id, userName: user.name })
    setAuthUser(null)
  }, [user])
  const can = useCallback((a: Permission) => !!user && PERMS[user.role].includes(a), [user])

  // Auto-lock after 15 minutes without any interaction.
  useEffect(() => {
    if (!user) return
    let timer = window.setTimeout(() => lock(), 15 * 60_000)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => lock(), 15 * 60_000)
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel']
    for (const e of events) window.addEventListener(e, reset, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, reset)
    }
  }, [user, lock])

  return <SessionContext.Provider value={{ user, shift, login, lock, can }}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
