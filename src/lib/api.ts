// Talks to the shop server (server/app.ts). The till works fully offline; the
// server adds STK Push, LAN printing and a durable copy of staff and products.
// Every call that changes data carries the signed token from staff sign-in.

import { db } from '../db/db'
import { getSettings } from '../db/settings'
import type { User } from '../db/types'

const TOKEN_KEY = 'optimas.token'

let token: string | null = (() => {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
})()

export function setToken(t: string | null) {
  token = t
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Private window: token lives in memory for this page only.
  }
}

/** Authorization header for callers that build their own fetch(). */
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function hasServerSession(): boolean {
  return !!token
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
  }
}

async function base(): Promise<string> {
  const s = await getSettings()
  return (s.apiUrl || '/api').replace(/\/$/, '')
}

/** fetch() against the shop server with the staff token attached. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(`${await base()}${path}`, { ...init, headers, body })
  const text = await res.text()
  let data: unknown = undefined
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = text
  }
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; message?: string }
    const msg = typeof data === 'string' && data ? data : obj.message ?? obj.error ?? `Server replied HTTP ${res.status}`
    if (res.status === 401 && path !== '/auth/login') setToken(null)
    throw new ApiError(msg, res.status, obj.error)
  }
  return data as T
}

type SyncUser = Omit<User, 'pin'>

const toSync = (u: User): SyncUser => ({
  id: u.id,
  name: u.name,
  role: u.role,
  active: u.active,
  pinHash: u.pinHash,
  mustChangePin: u.mustChangePin,
  email: u.email,
  phone: u.phone,
  about: u.about,
})

/** Copy the server's staff list onto this till (new till, or PINs changed on another till). */
async function adoptUsers(users: SyncUser[]) {
  await db.transaction('rw', db.users, async () => {
    for (const u of users) {
      const local = await db.users.get(u.id!)
      // The server's record wins (PIN and reset flag); the photo stays local.
      await db.users.put({ ...local, ...u, image: local?.image, mustChangePin: u.mustChangePin || undefined })
    }
  })
}

/**
 * After a successful offline sign-in, get a server token in the background.
 * If the server has never seen this shop, the owner registers the staff list.
 * Never throws — the till keeps working without the server.
 */
export async function serverSignIn(user: User, pin: string): Promise<void> {
  try {
    const r = await api<{ token: string; users: SyncUser[] }>('/auth/login', { method: 'POST', json: { userId: user.id, pin } })
    setToken(r.token)
    // Staff added on another till: bring them onto this one (existing local records are left alone).
    const missing: SyncUser[] = []
    for (const u of r.users) if (!(await db.users.get(u.id!))) missing.push(u)
    if (missing.length) await adoptUsers(missing)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code === 'setup' && user.role === 'owner') {
      try {
        await registerWithServer(user, pin)
      } catch {
        /* needs the setup code (Settings → Security) or the server is unreachable */
      }
    }
  }
}

const SETUP_CODE_KEY = 'optimas.setupCode'

/**
 * Owner: register this till's staff with a server that has none yet. Remote
 * servers ask for the SETUP_CODE from their .env; it's remembered on this till.
 */
export async function registerWithServer(user: User, pin: string, setupCode?: string): Promise<void> {
  let code = setupCode?.trim()
  if (!code) {
    try {
      code = localStorage.getItem(SETUP_CODE_KEY) ?? undefined
    } catch {
      code = undefined
    }
  }
  const users = (await db.users.toArray()).map(toSync)
  const r = await api<{ token: string }>('/auth/setup', { method: 'POST', json: { users, userId: user.id, pin, setupCode: code } })
  setToken(r.token)
  try {
    if (code) localStorage.setItem(SETUP_CODE_KEY, code)
  } catch {
    /* not remembered */
  }
}

export type ServerLink = 'connected' | 'needs-setup' | 'signed-out' | 'offline'

/** How this till stands with the shop server, for the Settings card. */
export async function serverLink(): Promise<ServerLink> {
  try {
    const st = await api<{ setup: boolean }>('/auth/status')
    if (st.setup) return 'needs-setup'
    return token ? 'connected' : 'signed-out'
  } catch {
    return 'offline'
  }
}

/** Get a token for an already-registered server (e.g. after it was unreachable at sign-in). */
export async function reconnectServer(user: User, pin: string): Promise<void> {
  const r = await api<{ token: string }>('/auth/login', { method: 'POST', json: { userId: user.id, pin } })
  setToken(r.token)
}

/** Sign in on a till that has no staff yet, using the server's records. */
export async function signInFromServer(userId: number, pin: string): Promise<User> {
  const r = await api<{ token: string; user: SyncUser; users: SyncUser[] }>('/auth/login', {
    method: 'POST',
    json: { userId, pin },
  })
  setToken(r.token)
  await adoptUsers(r.users)
  return (await db.users.get(userId))!
}

export async function serverStaff(): Promise<{ id: number; name: string; role: User['role'] }[]> {
  return api('/auth/staff')
}

/** Owner: push the till's staff list after adding/editing staff. Best effort. */
export async function pushUsers(): Promise<boolean> {
  if (!token) return false
  try {
    await api('/users', { method: 'PUT', json: (await db.users.toArray()).map(toSync) })
    return true
  } catch {
    return false
  }
}

/** Any user: push a new PIN record for themselves. Best effort. */
export async function pushOwnPin(currentPin: string, pinHash: string): Promise<boolean> {
  if (!token) return false
  try {
    await api('/users/me/pin', { method: 'PUT', json: { currentPin, pinHash } })
    return true
  } catch {
    return false
  }
}
