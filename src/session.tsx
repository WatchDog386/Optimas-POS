import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db/db'
import { logActivity } from './db/logs'
import { useSettings } from './db/settings'
import { isOpenHere } from './db/shifts'
import { verifyPin } from './lib/pinHash'
import { setToken } from './lib/api'
import { setSyncCredentials, startSync } from './lib/sync'
import type { Role, Shift, User } from './db/types'

export type LoginResult = { ok: true } | { ok: false; error: string; lockedMs?: number }

interface SessionValue {
  user: User | null
  shift: Shift | undefined
  login: (userId: number, pin: string) => Promise<LoginResult>
  /** Sign in a user already verified elsewhere (server sign-in on a new till, first-run setup). */
  adopt: (user: User, pin: string) => Promise<void>
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

export { PIN_MAX, PIN_MIN } from './lib/pinHash'

// Local brute-force protection: 5 misses lock that account for 30 s, doubling
// with every further miss up to 15 minutes. Stored in IndexedDB so a reload
// doesn't reset it.
const FREE_TRIES = 5
const lockKey = (userId: number) => `auth:lock:${userId}`

interface LockState {
  fails: number
  until: number
}

export async function lockRemaining(userId: number): Promise<number> {
  const row = await db.kv.get(lockKey(userId))
  const st = row?.value as LockState | undefined
  return st ? Math.max(0, st.until - Date.now()) : 0
}

async function recordFail(userId: number): Promise<LockState> {
  const row = await db.kv.get(lockKey(userId))
  const st = { ...((row?.value as LockState | undefined) ?? { fails: 0, until: 0 }) }
  st.fails++
  if (st.fails >= FREE_TRIES) st.until = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (st.fails - FREE_TRIES))
  await db.kv.put({ key: lockKey(userId), value: st })
  return st
}

/** Yield to the browser so a spinner can paint before the (synchronous) hash runs. */
const nextFrame = () => new Promise((r) => setTimeout(r, 30))

export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`
}

const SessionContext = createContext<SessionValue | null>(null)
export function SessionProvider({ children }: { children: ReactNode }) {
  const settings = useSettings()
  const [authUser, setAuthUser] = useState<User | null>(null)
  const shift = useLiveQuery(() => db.shifts.filter(isOpenHere).last(), [])
  // Keep the signed-in user live so profile edits (name, photo, PIN flag) show everywhere.
  const liveUser = useLiveQuery(() => (authUser?.id ? db.users.get(authUser.id) : undefined), [authUser?.id])
  const user = liveUser ?? authUser

  const begin = useCallback(async (u: User, pin: string) => {
    await db.users.update(u.id!, { lastLoginAt: Date.now() })
    await db.kv.delete(lockKey(u.id!))
    setAuthUser(u)
    await logActivity('auth', 'Signed in', { userId: u.id, userName: u.name })
    // Sync signs in to the shop server itself, and keeps retrying until it can.
    setToken(null) // a fresh server session for whoever signs in now
    setSyncCredentials({ user: u, pin })
    startSync()
  }, [])

  const login = useCallback(
    async (userId: number, pin: string): Promise<LoginResult> => {
      const u = await db.users.get(userId)
      if (!u || !u.active) return { ok: false, error: 'This staff account is not active' }
      const wait = await lockRemaining(userId)
      if (wait > 0) return { ok: false, error: `Too many wrong PINs. Try again in ${formatWait(wait)}.`, lockedMs: wait }
      await nextFrame()
      if (!verifyPin(pin, u.pinHash)) {
        const st = await recordFail(userId)
        await logActivity('auth', 'Wrong PIN', { userId: u.id, userName: u.name, detail: `attempt ${st.fails}` })
        const left = FREE_TRIES - st.fails
        if (st.until > Date.now()) {
          return { ok: false, error: `Too many wrong PINs. Locked for ${formatWait(st.until - Date.now())}.`, lockedMs: st.until - Date.now() }
        }
        return { ok: false, error: `Wrong PIN — ${left} ${left === 1 ? 'try' : 'tries'} left` }
      }
      await begin(u, pin)
      return { ok: true }
    },
    [begin],
  )

  const adopt = useCallback(async (u: User, pin: string) => begin(u, pin), [begin])

  const lock = useCallback(() => {
    if (!user) return
    void logActivity('auth', 'Till locked', { userId: user.id, userName: user.name })
    // Sync keeps running on the session it has, so sales made before locking
    // still reach the server; the PIN is forgotten.
    setSyncCredentials(null)
    setAuthUser(null)
  }, [user])

  // A deactivated account is signed out immediately.
  useEffect(() => {
    if (liveUser && !liveUser.active) lock()
  }, [liveUser, lock])

  const can = useCallback((a: Permission) => !!user && PERMS[user.role].includes(a), [user])

  // Auto-lock after the configured idle time.
  const idleMs = Math.max(0, settings.autoLockMinutes) * 60_000
  useEffect(() => {
    if (!user || idleMs === 0) return
    let timer = window.setTimeout(() => lock(), idleMs)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => lock(), idleMs)
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel']
    for (const e of events) window.addEventListener(e, reset, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, reset)
    }
  }, [user, lock, idleMs])

  return <SessionContext.Provider value={{ user, shift, login, adopt, lock, can }}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
