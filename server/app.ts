// Optimas POS server application (see index.ts for the process entry point).
//  - Serves the built app (dist/) so tills just open http://<shop-pc>:8787
//  - Staff sign-in (PBKDF2 PIN records, signed tokens, lockouts)
//  - M-Pesa STK Push via the pay gateway or Safaricom Daraja
//  - Relays raw ESC/POS / TSPL bytes to LAN printers on port 9100

import express from 'express'
import crypto from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDaraja, type StkCallbackBody } from './daraja'
import { sql } from './db'
import * as pinpay from './pinpay'
import { registerSyncRoutes } from './sync'
import {
  clearFailures,
  isPinHash,
  lockedFor,
  recordFailure,
  requireAuth,
  securityHeaders,
  signToken,
  verifyPinHash,
  type AuthedRequest,
  type Role,
} from './auth'

const ROLES: Role[] = ['owner', 'manager', 'cashier']

/** Loopback or RFC 1918 address (IPv4, or IPv4-mapped IPv6). */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (v4 === '::1') return true
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v4)
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  // Behind nginx on the same box: trust X-Forwarded-For from loopback only.
  app.set('trust proxy', 'loopback')
  app.use(securityHeaders)
  // /api/sync/push parses its own (larger) body.
  app.use((req, res, next) => (req.path === '/api/sync/push' ? next() : express.json({ limit: '2mb' })(req, res, next)))

  const staff = requireAuth()
  const owner = requireAuth(['owner'])
  const daraja = createDaraja(process.env)

  // --- M-Pesa ---------------------------------------------------------------

  type StkState = { status: 'pending' | 'success' | 'failed'; receipt?: string; message?: string; at: number }
  const stk = new Map<string, StkState>()

  // Forget stale requests so the map can't grow without bound.
  setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const [k, v] of stk) if (v.at < cutoff) stk.delete(k)
  }, 10 * 60 * 1000).unref()

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      mpesa: pinpay.payConfigured() ? 'pinnovatech pay gateway' : daraja.configured ? daraja.env : 'not configured',
    })
  })

  app.post('/api/mpesa/stkpush', staff, async (req, res) => {
    const { phone, amount, reference } = req.body ?? {}
    if (!/^254[17]\d{8}$/.test(String(phone)) || !Number.isInteger(amount) || amount < 1) {
      res.status(400).json({ error: 'phone must be 2547XXXXXXXX and amount a whole number of shillings' })
      return
    }
    const ref = String(reference ?? 'POS')

    // 1) PinnovaTech pay gateway — prompts the phone, records the txn in SQLite.
    if (pinpay.payConfigured()) {
      try {
        const r = await pinpay.promptPayment(String(phone), amount, ref)
        const now = Date.now()
        sql.prepare(
          `INSERT INTO mpesa_transactions (id, gateway_id, reference, phone, amount, status, request_json, response_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        ).run(
          r.transactionId,
          r.transactionId,
          ref,
          String(phone),
          amount,
          JSON.stringify({ phone, amount, reference: ref }),
          JSON.stringify(r.raw),
          now,
          now,
        )
        res.json({
          checkoutRequestId: r.transactionId,
          customerMessage: r.customerMessage ?? 'Prompt sent. Ask the customer to enter their M-Pesa PIN…',
        })
        return
      } catch (e) {
        res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
        return
      }
    }

    // 2) Fallback: direct Safaricom Daraja (MPESA_* credentials in .env).
    if (!daraja.configured) {
      res.status(503).json({ error: 'M-Pesa is not configured on the server (.env). Use manual code entry.' })
      return
    }
    try {
      const r = await daraja.stkPush(String(phone), amount, ref)
      stk.set(r.CheckoutRequestID, { status: 'pending', at: Date.now() })
      res.json({ checkoutRequestId: r.CheckoutRequestID, customerMessage: r.CustomerMessage })
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
    }
  })

  // Safaricom calls this (it must be reachable over public HTTPS, e.g. via a tunnel or your VPS).
  app.post('/api/mpesa/callback', (req, res) => {
    const cb = (req.body as StkCallbackBody)?.Body?.stkCallback
    if (cb?.CheckoutRequestID) {
      const receipt = cb.CallbackMetadata?.Item?.find((i) => i.Name === 'MpesaReceiptNumber')?.Value
      stk.set(cb.CheckoutRequestID, {
        status: cb.ResultCode === 0 ? 'success' : 'failed',
        receipt: receipt ? String(receipt) : undefined,
        message: cb.ResultDesc,
        at: Date.now(),
      })
    }
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  })

  type TxnRow = {
    id: string
    gateway_id: string | null
    reference: string | null
    phone: string
    amount: number
    status: 'pending' | 'success' | 'failed'
    receipt: string | null
    message: string | null
    created_at: number
  }

  app.get('/api/mpesa/status/:id', staff, async (req, res) => {
    const id = String(req.params.id)

    // --- PinnovaTech gateway txns (SQLite) ----------------------------------
    const row = sql.prepare('SELECT * FROM mpesa_transactions WHERE id = ? OR gateway_id = ?').get(id, id) as TxnRow | undefined
    if (row) {
      if (row.status !== 'pending') {
        res.json({ status: row.status, receipt: row.receipt ?? undefined, message: row.message ?? undefined })
        return
      }
      // Let the prompt settle before asking the gateway (till polls every 3s).
      if (Date.now() - row.created_at > 2_500) {
        try {
          const q = await pinpay.queryPayment({
            id: row.id,
            gatewayId: row.gateway_id,
            reference: row.reference,
            phone: row.phone,
            amount: row.amount,
          })
          const now = Date.now()
          if (q.status !== 'pending') {
            sql.prepare(
              'UPDATE mpesa_transactions SET status = ?, receipt = ?, message = ?, response_json = ?, updated_at = ? WHERE id = ?',
            ).run(q.status, q.receipt ?? null, q.message ?? null, JSON.stringify(q.raw), now, row.id)
            res.json({ status: q.status, receipt: q.receipt ?? undefined, message: q.message ?? undefined })
            return
          }
          sql.prepare('UPDATE mpesa_transactions SET response_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(q.raw), now, row.id)
        } catch {
          // Gateway unreachable — keep the pending state, the till keeps polling.
        }
      }
      res.json({ status: 'pending' })
      return
    }

    // --- Safaricom Daraja txns (in-memory) ----------------------------------
    const known = stk.get(id)
    if (known && known.status !== 'pending') {
      res.json(known)
      return
    }
    // No callback yet (e.g. callback URL unreachable on a LAN): ask Daraja directly.
    if (daraja.configured && known && Date.now() - known.at > 10_000) {
      try {
        const q = await daraja.stkQuery(id)
        // ResultCode is only present once the transaction has completed or failed.
        if (q.ResultCode !== undefined && q.ResultCode !== '') {
          const ok = String(q.ResultCode) === '0'
          // The query API does not return the receipt number; the cashier can add it later.
          const state: StkState = { status: ok ? 'success' : 'failed', message: q.ResultDesc, receipt: ok ? 'STK-CONFIRMED' : undefined, at: known.at }
          stk.set(id, state)
          res.json(state)
          return
        }
      } catch {
        // Still processing — Daraja returns an error until the customer responds.
      }
    }
    res.json(known ?? { status: 'pending' })
  })

  // --- Staff sign-in ----------------------------------------------------------

  type UserRow = {
    id: number
    name: string
    pin_hash: string
    role: Role
    active: number
    must_change_pin: number
    email: string | null
    phone: string | null
    about: string | null
  }

  const publicUser = (r: UserRow) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    active: !!r.active,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    about: r.about ?? undefined,
  })
  /** What a till needs to verify PINs offline after a server sign-in. */
  const syncUser = (r: UserRow) => ({ ...publicUser(r), pinHash: r.pin_hash, mustChangePin: r.must_change_pin ? true : undefined })

  const userCount = () => (sql.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n

  app.get('/api/auth/status', (_req, res) => {
    res.json({ setup: userCount() === 0 })
  })

  // Names shown on the sign-in screen of a new till (never PIN records).
  app.get('/api/auth/staff', (_req, res) => {
    const rows = sql.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY id').all()
    res.json(rows)
  })

  function cleanUser(u: Record<string, unknown>) {
    const id = Number(u.id)
    const name = String(u.name ?? '').trim().slice(0, 80)
    const role = String(u.role ?? '') as Role
    if (!Number.isInteger(id) || id < 1) throw new Error('each user needs a numeric id')
    if (!name) throw new Error('each user needs a name')
    if (!ROLES.includes(role)) throw new Error(`unknown role "${role}"`)
    if (!isPinHash(u.pinHash)) throw new Error(`user ${name} has no valid PIN record`)
    const opt = (v: unknown) => (v == null || v === '' ? null : String(v).slice(0, 500))
    return {
      id,
      name,
      role,
      pin_hash: u.pinHash,
      active: u.active === false ? 0 : 1,
      must_change_pin: u.mustChangePin === true ? 1 : 0,
      email: opt(u.email),
      phone: opt(u.phone),
      about: opt(u.about),
      updated_at: Date.now(),
    }
  }

  /**
   * Upsert the staff list pushed by a till (staff are managed on the till).
   * Accounts are never deleted here — staff are disabled instead — so a till
   * with an older copy of the list cannot wipe accounts added elsewhere.
   */
  function replaceUsers(list: unknown[]) {
    const rows = list.map((u) => cleanUser((u ?? {}) as Record<string, unknown>))
    if (!rows.some((r) => r.role === 'owner' && r.active)) throw new Error('keep at least one active owner')
    sql.transaction(() => {
      const upsert = sql.prepare(
        `INSERT INTO users (id, name, pin_hash, role, active, must_change_pin, email, phone, about, updated_at)
         VALUES (@id, @name, @pin_hash, @role, @active, @must_change_pin, @email, @phone, @about, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, pin_hash = excluded.pin_hash, role = excluded.role, active = excluded.active,
           must_change_pin = excluded.must_change_pin, email = excluded.email, phone = excluded.phone, about = excluded.about, updated_at = excluded.updated_at`,
      )
      for (const r of rows) upsert.run(r)
    })()
  }

  function lockMessage(ms: number) {
    const s = Math.ceil(ms / 1000)
    return `Too many wrong PINs. Try again in ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`
  }

  // First till to connect registers its staff. Only possible while the server
  // has no accounts, and the caller must prove it knows the owner's PIN and,
  // when configured, SETUP_CODE from the server's .env — so nobody on the
  // internet can claim a freshly deployed server.
  app.post('/api/auth/setup', (req, res) => {
    const { users, userId, pin, setupCode } = (req.body ?? {}) as { users?: unknown; userId?: unknown; pin?: unknown; setupCode?: unknown }
    if (userCount() > 0) {
      res.status(409).json({ error: 'The server already has staff accounts' })
      return
    }
    // With SETUP_CODE set it is always required (a proxy may hide the real
    // client address). Without one, only shop-network addresses may register.
    const expected = process.env.SETUP_CODE?.trim() ?? ''
    const allowed = expected ? typeof setupCode === 'string' && safeEqual(setupCode.trim(), expected) : isPrivateIp(req.ip ?? '')
    if (!allowed) {
      recordFailure([`ip:${req.ip}`])
      res.status(403).json({
        error: 'setup-code',
        message: expected
          ? 'Enter the server setup code (SETUP_CODE in the server .env file) to connect this till.'
          : 'Set SETUP_CODE in the server .env file, restart it, then enter that code on the till.',
      })
      return
    }
    if (!Array.isArray(users) || users.length === 0 || users.length > 200) {
      res.status(400).json({ error: 'expected a list of users' })
      return
    }
    const keys = [`ip:${req.ip}`]
    const wait = lockedFor(keys)
    if (wait > 0) {
      res.status(429).json({ error: lockMessage(wait) })
      return
    }
    const me = (users as Record<string, unknown>[]).find((u) => Number(u?.id) === Number(userId))
    if (!me || me.role !== 'owner' || typeof pin !== 'string' || !isPinHash(me.pinHash) || !verifyPinHash(pin, me.pinHash)) {
      recordFailure(keys)
      res.status(403).json({ error: 'Only the owner can register this till with the server' })
      return
    }
    try {
      replaceUsers(users)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
      return
    }
    clearFailures(keys)
    const rows = sql.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]
    res.json({ token: signToken(Number(userId), 'owner'), users: rows.map(syncUser) })
  })

  app.post('/api/auth/login', (req, res) => {
    const { userId, pin } = (req.body ?? {}) as { userId?: unknown; pin?: unknown }
    const id = Number(userId)
    if (!Number.isInteger(id) || typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
      res.status(400).json({ error: 'userId and a 4–6 digit PIN are required' })
      return
    }
    if (userCount() === 0) {
      res.status(404).json({ error: 'setup', message: 'The server has no staff accounts yet' })
      return
    }
    const keys = [`ip:${req.ip}`, `user:${id}`]
    const wait = lockedFor(keys)
    if (wait > 0) {
      res.status(429).json({ error: lockMessage(wait) })
      return
    }
    const row = sql.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id) as UserRow | undefined
    if (!row || !verifyPinHash(pin, row.pin_hash)) {
      recordFailure(keys)
      res.status(401).json({ error: 'Wrong PIN' })
      return
    }
    // Only the account's strikes reset: signing into your own account must not
    // wipe the IP's record of guesses against other accounts.
    clearFailures([`user:${id}`])
    const rows = sql.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]
    res.json({ token: signToken(row.id, row.role), user: publicUser(row), users: rows.map(syncUser) })
  })

  app.get('/api/users', staff, (_req, res) => {
    const rows = sql.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]
    res.json(rows.map(publicUser))
  })

  // Owner pushes the till's staff list (adds, removals, role and PIN changes).
  app.put('/api/users', owner, (req: AuthedRequest, res) => {
    if (!Array.isArray(req.body)) {
      res.status(400).json({ error: 'expected an array of users' })
      return
    }
    const self = (req.body as Record<string, unknown>[]).find((u) => Number(u?.id) === req.auth!.uid)
    if (!self || self.role !== 'owner' || self.active === false) {
      res.status(400).json({ error: 'you cannot remove or demote your own owner account' })
      return
    }
    try {
      replaceUsers(req.body)
      res.json({ ok: true, count: req.body.length })
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
    }
  })

  // Any signed-in user can change their own PIN, proving the current one.
  app.put('/api/users/me/pin', staff, (req: AuthedRequest, res) => {
    const { currentPin, pinHash } = (req.body ?? {}) as { currentPin?: unknown; pinHash?: unknown }
    const row = sql.prepare('SELECT * FROM users WHERE id = ?').get(req.auth!.uid) as UserRow
    const keys = [`ip:${req.ip}`, `user:${row.id}`]
    const wait = lockedFor(keys)
    if (wait > 0) {
      res.status(429).json({ error: lockMessage(wait) })
      return
    }
    if (typeof currentPin !== 'string' || !verifyPinHash(currentPin, row.pin_hash)) {
      recordFailure(keys)
      res.status(403).json({ error: 'Current PIN is wrong' })
      return
    }
    if (!isPinHash(pinHash)) {
      res.status(400).json({ error: 'invalid PIN record' })
      return
    }
    sql.prepare('UPDATE users SET pin_hash = ?, must_change_pin = 0, updated_at = ? WHERE id = ?').run(pinHash, Date.now(), row.id)
    res.json({ ok: true })
  })

  // --- Data sync (sales, stock, catalogue, customers, settings…) ---------------

  registerSyncRoutes(app, staff)

  // --- Network printer relay -----------------------------------------------

  const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/

  app.post('/api/print', staff, (req, res) => {
    const { host, port = 9100, data } = req.body ?? {}
    // Only relay to printers on the shop's own network.
    if (typeof host !== 'string' || !net.isIPv4(host) || !PRIVATE_IP.test(host)) {
      res.status(400).send('host must be a private IPv4 address')
      return
    }
    const portNum = Number(port)
    if (!Number.isInteger(portNum) || portNum < 9100 || portNum > 9109) {
      res.status(400).send('port must be a raw-print port (9100–9109)')
      return
    }
    if (typeof data !== 'string' || data.length > 2_000_000) {
      res.status(400).send('data (base64) is required')
      return
    }
    const socket = net.createConnection({ host, port: portNum })
    socket.setTimeout(5000)
    socket.on('connect', () => socket.end(Buffer.from(data, 'base64')))
    socket.on('close', (hadError) => {
      if (!hadError && !res.headersSent) res.json({ ok: true })
    })
    socket.on('timeout', () => {
      socket.destroy()
      if (!res.headersSent) res.status(504).send(`Printer ${host}:${port} did not respond`)
    })
    socket.on('error', (e) => {
      if (!res.headersSent) res.status(502).send(`Printer error: ${e.message}`)
    })
  })

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  // --- Static app ----------------------------------------------------------

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  if (existsSync(dist)) {
    // Hashed build assets never change; the shell and service worker must revalidate.
    app.use(
      express.static(dist, {
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          else res.setHeader('Cache-Control', 'no-cache')
        },
      }),
    )
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  return { app, daraja, distBuilt: existsSync(dist) }
}
