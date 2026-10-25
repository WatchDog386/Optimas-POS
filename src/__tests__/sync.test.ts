import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { db, outboxId, queueAllForUpload } from '../db/db'
import { completeSale } from '../db/sales'
import { createUnits } from '../db/units'
import { saveSettings } from '../db/settings'
import { currentTill, setCurrentTill } from '../db/till'
import { applyChanges, pullChanges, pushChanges, registerTill } from '../lib/sync'
import { setToken } from '../lib/api'
import { migrate, sql } from '../../server/db'
import { createApp } from '../../server/app'
import { resetFailures } from '../../server/auth'
import { hashPin } from '../lib/pinHash'
import { bySku, lineFor, seedTestData } from './fixtures'

const outbox = async () => (await db.outbox.toArray()).map((e) => e.id).sort()

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('outbox', () => {
  it('records creates, updates and every kind of delete', async () => {
    const id = (await db.categories.add({ name: 'Brakes', color: '#f00' })) as number
    expect(await outbox()).toEqual([outboxId('categories', id)])
    await db.outbox.clear()

    await db.categories.update(id, { color: '#0f0' })
    expect(await outbox()).toEqual([outboxId('categories', id)])
    await db.outbox.clear()

    const a = (await db.suppliers.add({ name: 'A' })) as number
    const b = (await db.suppliers.add({ name: 'B' })) as number
    await db.outbox.clear()
    await db.suppliers.where('name').equals('A').delete()
    expect(await outbox()).toEqual([outboxId('suppliers', a)])
    await db.outbox.clear()
    await db.suppliers.clear()
    expect(await outbox()).toEqual([outboxId('suppliers', b)])
  })

  it('shares only the settings from the key/value table', async () => {
    await db.kv.put({ key: 'seq:R', value: 4 })
    expect(await outbox()).toEqual([])
    await saveSettings({ shopName: 'Shop' })
    expect(await outbox()).toContain(outboxId('kv', 'settings'))
  })

  it('does not queue staff accounts (they sync through the auth API)', async () => {
    await db.outbox.clear()
    await db.users.add({ name: 'X', pinHash: hashPin('5821', 1000), role: 'owner', active: true })
    expect(await outbox()).toEqual([])
  })

  it('gives new records IDs unique across tills', async () => {
    setCurrentTill(5)
    const ids = await Promise.all(Array.from({ length: 50 }, (_, i) => db.categories.add({ name: `c${i}`, color: '#000' })))
    expect(new Set(ids).size).toBe(50)
    for (const id of ids as number[]) expect(Math.floor(id / 32) % 64).toBe(5)
  })

  it('queues everything already on the till for the first upload', async () => {
    await seedTestData()
    await db.outbox.clear()
    const n = await queueAllForUpload()
    expect(n).toBe(7) // 6 products + 1 customer
    expect((await db.outbox.count())).toBe(7)
  })
})

describe('applying server changes', () => {
  it('is not echoed back, removes deleted records and rebuilds stock from movements', async () => {
    await applyChanges([
      { t: 'products', k: 1, d: { id: 1, sku: 'P1', name: 'Pads', fitment: [], stock: 999, price: 100, cost: 50, trackStock: true, active: true } },
      { t: 'movements', k: 2, d: { id: 2, productId: 1, change: 5, reason: 'count', at: 1 } },
      { t: 'movements', k: 3, d: { id: 3, productId: 1, change: -2, reason: 'sale', at: 2 } },
    ])
    expect(await db.outbox.count()).toBe(0)
    expect((await db.products.get(1))!.stock).toBe(3)

    await applyChanges([{ t: 'products', k: 1, d: null }])
    expect(await db.products.get(1)).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('keeps local changes that are still waiting to be pushed', async () => {
    const id = (await db.categories.add({ name: 'Mine', color: '#000' })) as number
    await applyChanges([{ t: 'categories', k: id, d: { id, name: 'Theirs', color: '#fff' } }])
    expect((await db.categories.get(id))!.name).toBe('Mine')
  })

  it('renames a clashing local SKU instead of failing', async () => {
    const mine = (await db.products.add({ sku: 'DUP', name: 'Mine', fitment: [], cost: 0, price: 1, stock: 0, reorderLevel: 0, taxable: true, serialized: false, trackStock: true, active: true, createdAt: 1, updatedAt: 1 })) as number
    await db.outbox.clear()
    await applyChanges([{ t: 'products', k: 77, d: { id: 77, sku: 'DUP', name: 'Theirs', fitment: [], price: 1, cost: 0, trackStock: true, active: true } }])
    expect((await db.products.get(77))!.sku).toBe('DUP')
    expect((await db.products.get(mine))!.sku).toMatch(/^DUP-T\d{2}$/)
    expect(await outbox()).toEqual([outboxId('products', mine)])
  })
})

describe('two tills through the real server', () => {
  let server: Server

  beforeAll(async () => {
    migrate()
    const { app } = createApp()
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
  })
  afterAll(() => server?.close())

  it('moves sales, labels and deletions between tills and keeps stock right', async () => {
    resetFailures()
    for (const t of ['users', 'sync_records', 'tills']) sql.prepare(`DELETE FROM ${t}`).run()
    const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`

    // Till A: register staff with the server and sign in.
    await seedTestData()
    await saveSettings({ apiUrl })
    const owner = (await db.users.get(1))!
    const setup = await fetch(`${apiUrl}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: [{ ...owner, pinHash: owner.pinHash }], userId: 1, pin: '0735' }),
    }).then((r) => r.json())
    setToken(setup.token)
    setCurrentTill(3)
    expect(await registerTill()).toBe(3)

    const pads = await bySku('BRK-PAD-F')
    await db.movements.add({ productId: pads.id!, change: pads.stock, reason: 'count', at: 1 })
    const [unit] = await createUnits(pads.id!, 1, 'Opening stock')
    await completeSale({ lines: [lineFor(pads, 1, unit.serial)], discount: 0, payments: [{ method: 'cash', amount: 850_00 }], userId: 1 })
    const helmet = await bySku('ACC-HLM')
    await db.products.delete(helmet.id!)
    await queueAllForUpload()
    await pushChanges()
    expect(await db.outbox.count()).toBe(0)

    // Till B: a fresh browser on another computer.
    await db.delete()
    await db.open()
    await saveSettings({ apiUrl })
    await db.outbox.clear()
    setCurrentTill(3) // same random number by chance — the server must give it another
    const b = await registerTill()
    expect(b).not.toBe(3)
    await pullChanges()

    const padsB = (await db.products.where('sku').equals('BRK-PAD-F').first())!
    expect(padsB.stock).toBe(9) // 10 counted, 1 sold on till A
    expect(await db.products.where('sku').equals('ACC-HLM').count()).toBe(0)
    expect(await db.sales.count()).toBe(1)
    expect((await db.units.where('serial').equals(unit.serial).first())!.status).toBe('sold')
    expect(await db.outbox.count()).toBe(0)

    // Till B sells too; till A's later pull must see stock 8, not a stale overwrite.
    await completeSale({ lines: [lineFor(padsB, 1)], discount: 0, payments: [{ method: 'cash', amount: 850_00 }], userId: 1 })
    await pushChanges()
    expect(currentTill()).toBe(b)
    const st = await fetch(`${apiUrl}/sync/status`, { headers: { Authorization: `Bearer ${setup.token}` } }).then((r) => r.json())
    expect(st.counts.sales).toBe(2)
    expect(st.counts.movements).toBe(3)
    setToken(null)
  })
})
