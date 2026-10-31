import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { db } from '../db/db'
import { createUnits } from '../db/units'
import { saveSettings } from '../db/settings'
import { setCurrentTill } from '../db/till'
import { pullChanges, pushChanges, registerTill } from '../lib/sync'
import { setToken } from '../lib/api'
import { migrate, sql } from '../../server/db'
import { createApp } from '../../server/app'
import { resetFailures } from '../../server/auth'
import type { Product } from '../db/types'

let server: Server
let apiUrl = ''
beforeAll(async () => {
  migrate()
  const { app } = createApp()
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())))
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
})
afterAll(() => server?.close())
beforeEach(async () => {
  resetFailures()
  for (const t of ['users', 'sync_records', 'tills']) sql.prepare(`DELETE FROM ${t}`).run()
  await db.delete()
  await db.open()
})

async function addPart(sku: string, name: string, qty: number) {
  const now = Date.now()
  const id = (await db.products.add({ sku, name, fitment: [], cost: 0, price: 650_00, stock: qty, reorderLevel: 2, taxable: true, serialized: false, trackStock: true, active: true, createdAt: now, updatedAt: now } as Product)) as number
  await db.movements.add({ productId: id, change: qty, reason: 'count', note: 'Opening stock', at: now })
  await createUnits(id, qty, 'Opening stock')
  return id
}

it('parts added offline survive coming back online, even when another till used the same SKUs', async () => {
  await saveSettings({ apiUrl })
  const owner = (await db.users.toArray()).find((u) => u.role === 'owner')!
  const setup = await fetch(`${apiUrl}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: await db.users.toArray(), userId: owner.id, pin: '0735' }),
  }).then((r) => r.json())
  expect(setup.token).toBeTruthy()

  // Till B (phone) is online and adds 0001, 0002.
  setToken(setup.token)
  setCurrentTill(9)
  await registerTill()
  await addPart('0001', 'Brake lever', 2)
  await addPart('0002', 'Mirror', 1)
  await pushChanges()

  // Till A (desktop) — fresh, offline: adds 0001..0003 of its own.
  await db.delete()
  await db.open()
  await saveSettings({ apiUrl })
  setCurrentTill(4)
  await addPart('0001', 'Left hand switch', 3)
  await addPart('0002', 'Right hand switch', 3)
  await addPart('0003', 'Throttle', 2)

  // Back online.
  await registerTill()
  await pushChanges()
  await pullChanges()
  await pushChanges()
  const names = (await db.products.toArray()).map((p) => `${p.sku}:${p.name}:${p.stock}`).sort()
  console.log(names)
  expect(names.filter((n) => /switch|Throttle/.test(n))).toHaveLength(3)
  expect(await db.units.count()).toBe(3 + 3 + 2 + 2 + 1)
  setToken(null)
})

it('keeps deleted parts restorable on the till and on the server', async () => {
  const { trashProducts, listTrash, restoreFromTrash, findOrphans, rebuildOrphans } = await import('../db/recovery')
  const { attachPrintedLabels } = await import('../db/units')
  await saveSettings({ apiUrl })
  const owner = (await db.users.toArray()).find((u) => u.role === 'owner')!
  const setup = await fetch(`${apiUrl}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: await db.users.toArray(), userId: owner.id, pin: '0735' }),
  }).then((r) => r.json())
  setToken(setup.token)
  setCurrentTill(6)
  await registerTill()

  const id = await addPart('0001', 'Left hand switch', 3)
  const serials = (await db.units.toArray()).map((u) => u.serial)
  await pushChanges()

  // Delete it the way the Delete button does.
  await db.transaction('rw', [db.products, db.movements, db.units, db.kv], async () => {
    await trashProducts([id], 'Optimas Admin')
    await db.movements.where('productId').equals(id).delete()
    await db.units.where('productId').equals(id).delete()
    await db.products.delete(id)
  })
  await pushChanges()
  const kept = sql.prepare("SELECT COUNT(*) AS n FROM sync_deleted WHERE tbl = 'products'").get() as { n: number }
  expect(kept.n).toBe(1)

  // Recycle bin restores the part with the same labels and stock.
  expect((await listTrash()).map((e) => e.product.name)).toEqual(['Left hand switch'])
  expect(await restoreFromTrash([id])).toBe(1)
  expect((await db.products.get(id))!.stock).toBe(3)
  expect((await db.units.where('productId').equals(id).toArray()).map((u) => u.serial).sort()).toEqual(serials.sort())

  // Labels whose part vanished are rebuilt into a part with the same ID.
  await db.products.delete(id)
  expect((await findOrphans()).map((o) => o.productId)).toEqual([id])
  expect(await rebuildOrphans(await findOrphans())).toBe(1)
  expect((await db.products.get(id))!.stock).toBe(3)

  // Printed labels that the till no longer knows can be attached to a part again.
  await db.units.clear()
  const r = await attachPrintedLabels(id, [...serials, '123', serials[0]])
  expect(r.added.sort()).toEqual([...serials].sort())
  expect(r.skipped.map((x) => x.reason)).toEqual(['not a valid label barcode'])
  expect((await db.products.get(id))!.stock).toBe(6)
  setToken(null)
})

it('a till signed in while the server was down starts syncing by itself when it is back', async () => {
  const { setSyncCredentials, syncNow } = await import('../lib/sync')
  const { signToken } = await import('../../server/auth')
  // Register the shop's staff on the server once.
  const owner = (await db.users.toArray()).find((u) => u.role === 'owner')!
  await fetch(`${apiUrl}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: await db.users.toArray(), userId: owner.id, pin: '0735' }),
  })
  setToken(null)

  // Signed in during the outage: the server can't be reached.
  await saveSettings({ apiUrl: 'http://127.0.0.1:9/api' })
  setSyncCredentials({ user: owner, pin: '0735' })
  await syncNow()
  await addPart('0001', 'Left hand switch', 2)
  expect(await db.outbox.count()).toBeGreaterThan(0)

  // Server is back: the next round signs in and uploads without anyone touching the till.
  await saveSettings({ apiUrl })
  setSyncCredentials({ user: owner, pin: '0735' }) // skip the 20 s retry wait in the test
  await syncNow()
  expect(await db.outbox.count()).toBe(0)
  const onServer = sql.prepare("SELECT COUNT(*) AS n FROM sync_records WHERE tbl = 'products' AND data IS NOT NULL").get() as { n: number }
  expect(onServer.n).toBe(1)

  // An old session is renewed instead of expiring mid-day.
  const old = signToken(owner.id!, 'owner', Date.now() - 11 * 60 * 60 * 1000)
  const res = await fetch(`${apiUrl}/sync/status`, { headers: { Authorization: `Bearer ${old}` } })
  expect(res.status).toBe(200)
  expect(res.headers.get('X-Session-Token')).toBeTruthy()
  setSyncCredentials(null)
  setToken(null)
})
