// Staff authentication for the server API.
//
// The till verifies PINs offline against its own IndexedDB copy; the server
// holds the same PBKDF2 records (never plain PINs) and hands out short-lived
// signed tokens. Every endpoint that changes data, prints, or charges a phone
// requires one of those tokens.

import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { sql } from './db'

export type Role = 'owner' | 'manager' | 'cashier'

export interface TokenClaims {
  uid: number
  role: Role
  exp: number
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function signingKey(): Buffer {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32) return Buffer.from(process.env.AUTH_SECRET)
  const row = sql.prepare("SELECT value FROM server_kv WHERE key = 'auth_secret'").get() as { value: string } | undefined
  if (row) return Buffer.from(row.value, 'base64')
  const fresh = crypto.randomBytes(48)
  sql.prepare("INSERT INTO server_kv (key, value) VALUES ('auth_secret', ?)").run(fresh.toString('base64'))
  return fresh
}

let key: Buffer | null = null
const getKey = () => (key ??= signingKey())

const b64url = (b: Buffer) => b.toString('base64url')

export function signToken(uid: number, role: Role, now = Date.now()): string {
  const payload = b64url(Buffer.from(JSON.stringify({ uid, role, exp: now + TOKEN_TTL_MS } satisfies TokenClaims)))
  const mac = b64url(crypto.createHmac('sha256', getKey()).update(payload).digest())
  return `${payload}.${mac}`
}

export function verifyToken(token: string, now = Date.now()): TokenClaims | null {
  const [payload, mac] = token.split('.')
  if (!payload || !mac) return null
  const expected = crypto.createHmac('sha256', getKey()).update(payload).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenClaims
    if (typeof claims.uid !== 'number' || typeof claims.exp !== 'number' || claims.exp < now) return null
    return claims
  } catch {
    return null
  }
}

/** Same record format as src/lib/pinHash.ts: pbkdf2-sha256$iter$salt$hash. */
export function isPinHash(value: unknown): value is string {
  return typeof value === 'string' && /^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(value)
}

export function verifyPinHash(pin: string, record: string): boolean {
  if (!isPinHash(record)) return false
  const [, iterStr, salt, hash] = record.split('$')
  const iterations = Number(iterStr)
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 2_000_000) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = crypto.pbkdf2Sync(pin, Buffer.from(salt, 'base64'), iterations, expected.length || 32, 'sha256')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

// --- brute-force protection -------------------------------------------------
// 4–6 digit PINs are only safe with lockouts. Per account: after 5 misses it is
// locked for 1 minute, doubling each further miss, capped at 30 minutes. Per
// IP the allowance is larger (20), since every till in a shop can share one
// public address, but it still stops anyone cycling through accounts.

interface Strike {
  count: number
  until: number
}
const strikes = new Map<string, Strike>()

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [k, v] of strikes) if (v.until < cutoff) strikes.delete(k)
}, 10 * 60 * 1000).unref()

const freeTries = (key: string) => (key.startsWith('ip:') ? 20 : 5)

export function lockedFor(keys: string[], now = Date.now()): number {
  return Math.max(0, ...keys.map((k) => (strikes.get(k)?.until ?? 0) - now))
}

export function recordFailure(keys: string[], now = Date.now()): void {
  for (const k of keys) {
    const s = strikes.get(k) ?? { count: 0, until: 0 }
    s.count++
    const free = freeTries(k)
    if (s.count >= free) s.until = now + Math.min(30 * 60_000, 60_000 * 2 ** (s.count - free))
    else s.until = Math.max(s.until, now)
    strikes.set(k, s)
  }
}

export function clearFailures(keys: string[]): void {
  for (const k of keys) strikes.delete(k)
}

/** Test helper. */
export function resetFailures(): void {
  strikes.clear()
}

// --- middleware --------------------------------------------------------------

export interface AuthedRequest extends Request {
  auth?: TokenClaims & { name: string }
}

/** Require a valid token from an active user, optionally limited to roles. */
export function requireAuth(roles?: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const claims = token ? verifyToken(token) : null
    if (!claims) {
      res.status(401).json({ error: 'Sign in again — your session has expired' })
      return
    }
    const user = sql.prepare('SELECT name, role, active FROM users WHERE id = ?').get(claims.uid) as
      | { name: string; role: Role; active: number }
      | undefined
    if (!user || !user.active) {
      res.status(401).json({ error: 'This staff account is no longer active' })
      return
    }
    if (roles && !roles.includes(user.role)) {
      res.status(403).json({ error: 'Your role is not allowed to do this' })
      return
    }
    req.auth = { uid: claims.uid, role: user.role, exp: claims.exp, name: user.name }
    next()
  }
}

/** Baseline security headers for the app and API. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      // The Optimas Print Agent runs on the till computer itself.
      "connect-src 'self' http://127.0.0.1:9180 http://localhost:9180",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  )
  next()
}
