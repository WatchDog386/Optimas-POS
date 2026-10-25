import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { migrate, sql } from '../../server/db'
import { createApp } from '../../server/app'
import { resetFailures } from '../../server/auth'
import { hashPin } from '../lib/pinHash'

let server: Server
let base = ''

beforeAll(async () => {
  migrate()
  const { app } = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
})

afterAll(() => {
  server?.close()
})

beforeEach(() => {
  resetFailures()
  sql.prepare('DELETE FROM users').run()
  sql.prepare('DELETE FROM products').run()
})

const staff = [
  { id: 1, name: 'Owner', role: 'owner', active: true, pinHash: hashPin('582193', 1000) },
  { id: 2, name: 'Cashier', role: 'cashier', active: true, pinHash: hashPin('739104', 1000), mustChangePin: true },
]

async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    // plain-text error (the print relay)
  }
  return { status: res.status, body: body as any, headers: res.headers }
}

async function registerAndLogin(userId = 1, pin = '582193') {
  await call('/auth/setup', { method: 'POST', body: { users: staff, userId: 1, pin: '582193' } })
  const r = await call('/auth/login', { method: 'POST', body: { userId, pin } })
  return r.body.token as string
}

describe('server auth', () => {
  it('starts in setup mode and only lets the owner register staff', async () => {
    expect((await call('/auth/status')).body).toEqual({ setup: true })
    expect((await call('/auth/login', { method: 'POST', body: { userId: 1, pin: '582193' } })).status).toBe(404)
    expect((await call('/auth/setup', { method: 'POST', body: { users: staff, userId: 1, pin: '000000' } })).status).toBe(403)
    expect((await call('/auth/setup', { method: 'POST', body: { users: staff, userId: 2, pin: '739104' } })).status).toBe(403)
    const ok = await call('/auth/setup', { method: 'POST', body: { users: staff, userId: 1, pin: '582193' } })
    expect(ok.status).toBe(200)
    expect(typeof ok.body.token).toBe('string')
    // A second registration is refused.
    expect((await call('/auth/setup', { method: 'POST', body: { users: staff, userId: 1, pin: '582193' } })).status).toBe(409)
    expect((await call('/auth/status')).body).toEqual({ setup: false })
  })

  it('requires the setup code when one is configured', async () => {
    process.env.SETUP_CODE = 'shop-code-7731'
    try {
      expect((await call('/auth/setup', { method: 'POST', body: { users: staff, userId: 1, pin: '582193' } })).body.error).toBe('setup-code')
      expect((await call('/auth/setup', { method: 'POST', body: { users: staff, userId: 1, pin: '582193', setupCode: 'wrong' } })).status).toBe(403)
      expect((await call('/auth/setup', { method: 'POST', body: { users: staff, userId: 1, pin: '582193', setupCode: 'shop-code-7731' } })).status).toBe(200)
    } finally {
      delete process.env.SETUP_CODE
    }
  })

  it('never exposes PIN records publicly', async () => {
    await registerAndLogin()
    const list = await call('/auth/staff')
    expect(list.body).toEqual([
      { id: 1, name: 'Owner', role: 'owner' },
      { id: 2, name: 'Cashier', role: 'cashier' },
    ])
    expect(JSON.stringify(list.body)).not.toContain('pbkdf2')
  })

  it('protects data, printing and payments behind a token', async () => {
    expect((await call('/users')).status).toBe(401)
    expect((await call('/products', { method: 'DELETE' })).status).toBe(401)
    expect((await call('/settings', { method: 'PUT', body: {} })).status).toBe(401)
    expect((await call('/print', { method: 'POST', body: { host: '192.168.1.5', data: '' } })).status).toBe(401)
    expect((await call('/mpesa/stkpush', { method: 'POST', body: { phone: '254712345678', amount: 10 } })).status).toBe(401)
    expect((await call('/users', { token: 'forged.token' })).status).toBe(401)
    // The Safaricom callback must stay public.
    expect((await call('/mpesa/callback', { method: 'POST', body: {} })).status).toBe(200)
  })

  it('enforces roles', async () => {
    const cashier = await registerAndLogin(2, '739104')
    expect((await call('/users', { token: cashier })).status).toBe(200)
    expect((await call('/products', { method: 'POST', token: cashier, body: { sku: 'A', name: 'B' } })).status).toBe(403)
    expect((await call('/products', { method: 'DELETE', token: cashier })).status).toBe(403)
    expect((await call('/users', { method: 'PUT', token: cashier, body: staff })).status).toBe(403)
    const owner = (await call('/auth/login', { method: 'POST', body: { userId: 1, pin: '582193' } })).body.token
    expect((await call('/products', { method: 'POST', token: owner, body: { sku: 'A', name: 'B', price: 100 } })).status).toBe(200)
  })

  it('locks an account after repeated wrong PINs', async () => {
    await registerAndLogin()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await call('/auth/login', { method: 'POST', body: { userId: 2, pin: '111222' } })).status)
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
    // Even the right PIN is refused while locked.
    expect((await call('/auth/login', { method: 'POST', body: { userId: 2, pin: '739104' } })).status).toBe(429)
  })

  it('cuts off a deactivated user immediately', async () => {
    const owner = await registerAndLogin()
    const cashier = (await call('/auth/login', { method: 'POST', body: { userId: 1, pin: '582193' } })).body.token as string
    expect(cashier).toBeTruthy()
    const updated = staff.map((u) => (u.id === 1 ? u : { ...u, active: false }))
    expect((await call('/users', { method: 'PUT', token: owner, body: updated })).status).toBe(200)
    expect((await call('/auth/login', { method: 'POST', body: { userId: 2, pin: '739104' } })).status).toBe(401)
    // The owner cannot remove their own account.
    expect((await call('/users', { method: 'PUT', token: owner, body: [staff[1]] })).status).toBe(400)
    // A till with an older list (owner only) does not delete the cashier.
    expect((await call('/users', { method: 'PUT', token: owner, body: [staff[0]] })).status).toBe(200)
    expect((await call('/auth/staff')).body.map((u: { id: number }) => u.id)).toEqual([1])
    expect((await call('/users', { token: owner })).body).toHaveLength(2)
  })

  it('carries the PIN-reset flag to other tills and clears it on change', async () => {
    await registerAndLogin()
    const login = await call('/auth/login', { method: 'POST', body: { userId: 2, pin: '739104' } })
    const me = login.body.users.find((u: { id: number }) => u.id === 2)
    expect(me.mustChangePin).toBe(true)
    await call('/users/me/pin', { method: 'PUT', token: login.body.token, body: { currentPin: '739104', pinHash: hashPin('604918', 1000) } })
    const again = await call('/auth/login', { method: 'POST', body: { userId: 2, pin: '604918' } })
    expect(again.body.users.find((u: { id: number }) => u.id === 2).mustChangePin).toBeUndefined()
  })

  it('lets a user change their own PIN only with the current one', async () => {
    await registerAndLogin()
    const token = (await call('/auth/login', { method: 'POST', body: { userId: 1, pin: '582193' } })).body.token
    const next = hashPin('604918', 1000)
    expect((await call('/users/me/pin', { method: 'PUT', token, body: { currentPin: '000000', pinHash: next } })).status).toBe(403)
    expect((await call('/users/me/pin', { method: 'PUT', token, body: { currentPin: '582193', pinHash: next } })).status).toBe(200)
    expect((await call('/auth/login', { method: 'POST', body: { userId: 1, pin: '604918' } })).status).toBe(200)
  })

  it('only relays prints to private printers on raw-print ports', async () => {
    const token = await registerAndLogin()
    expect((await call('/print', { method: 'POST', token, body: { host: '8.8.8.8', data: '' } })).status).toBe(400)
    expect((await call('/print', { method: 'POST', token, body: { host: '192.168.1.5', port: 22, data: '' } })).status).toBe(400)
  })

  it('sends security headers', async () => {
    const r = await call('/health')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('x-frame-options')).toBe('DENY')
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(r.headers.get('x-powered-by')).toBeNull()
    expect(r.body).not.toHaveProperty('db')
  })
})
