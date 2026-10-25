import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { db, PosDB, PRE_PRODUCTION_ARCHIVE } from '../db/db'
import { adjustStock, completeSale, refundSale } from '../db/sales'
import { createUnits, lookupCode, unlabelledCount } from '../db/units'
import { createOwner, needsSetup } from '../db/seed'
import { isValidEan13 } from '../lib/barcode'
import { verifyPin } from '../lib/pinHash'
import { bySku, lineFor, seedTestData } from './fixtures'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await seedTestData()
})

describe('serial labels', () => {
  it('gives every unit its own valid, unique barcode', async () => {
    const pads = await bySku('BRK-PAD-F')
    const units = await createUnits(pads.id!, 25, 'Opening stock')
    expect(units).toHaveLength(25)
    expect(new Set(units.map((u) => u.serial)).size).toBe(25)
    for (const u of units) {
      expect(isValidEan13(u.serial)).toBe(true)
      expect(u.serial.startsWith('21')).toBe(true)
      expect(u.status).toBe('in_stock')
    }
    const more = await createUnits(pads.id!, 2, 'PO-000001')
    expect(units.map((u) => u.serial)).not.toContain(more[0].serial)
  })

  it('resolves a scanned label to its part and sells exactly that unit', async () => {
    const pads = await bySku('BRK-PAD-F')
    const [a, b] = await createUnits(pads.id!, 2, 'Opening stock')
    const products = await db.products.toArray()
    const match = await lookupCode(a.serial, products)
    expect(match).toEqual({ product: expect.objectContaining({ id: pads.id }), serial: a.serial })

    const sale = await completeSale({ lines: [lineFor(pads, 1, a.serial)], discount: 0, payments: [{ method: 'cash', amount: 850_00 }], userId: 1 })
    const sold = (await db.units.get(a.id!))!
    expect(sold.status).toBe('sold')
    expect(sold.receiptNo).toBe(sale.receiptNo)
    expect((await db.units.get(b.id!))!.status).toBe('in_stock')
    expect((await db.products.get(pads.id!))!.stock).toBe(9)

    // Re-scanning or re-selling the same label is blocked.
    expect(await lookupCode(a.serial, products)).toEqual({ error: expect.stringContaining('already sold') })
    await expect(
      completeSale({ lines: [lineFor(pads, 1, a.serial)], discount: 0, payments: [{ method: 'cash', amount: 850_00 }], userId: 1 }),
    ).rejects.toThrow(/already sold/)
  })

  it('rejects the same label twice in one sale and labels from another part', async () => {
    const pads = await bySku('BRK-PAD-F')
    const tube = await bySku('TUB-17')
    const [a] = await createUnits(pads.id!, 1, 'Opening stock')
    await expect(
      completeSale({ lines: [lineFor(pads, 1, a.serial), lineFor(pads, 1, a.serial)], discount: 0, payments: [{ method: 'cash', amount: 2_000_00 }], userId: 1 }),
    ).rejects.toThrow(/twice/)
    await expect(
      completeSale({ lines: [lineFor(tube, 1, a.serial)], discount: 0, payments: [{ method: 'cash', amount: 650_00 }], userId: 1 }),
    ).rejects.toThrow(/different part/)
  })

  it('puts a refunded, restocked unit back on the shelf', async () => {
    const pads = await bySku('BRK-PAD-F')
    const [a] = await createUnits(pads.id!, 1, 'Opening stock')
    const sale = await completeSale({ lines: [lineFor(pads, 1, a.serial)], discount: 0, payments: [{ method: 'cash', amount: 850_00 }], userId: 1 })
    await refundSale(sale.id!, { qtyByLine: { 0: 1 }, restock: true, method: 'cash', userId: 1 })
    expect((await db.units.get(a.id!))!.status).toBe('in_stock')
  })

  it('labels stock added by an adjustment and reports unlabelled stock', async () => {
    const pads = await bySku('BRK-PAD-F')
    expect(await unlabelledCount(pads)).toBe(10)
    const created = await adjustStock(pads.id!, 3, 'adjust', 1, 'Delivery', undefined, true)
    expect(created).toHaveLength(3)
    const updated = (await db.products.get(pads.id!))!
    expect(updated.stock).toBe(13)
    expect(await unlabelledCount(updated)).toBe(10)
    expect(await adjustStock(pads.id!, -1, 'damage', 1, undefined, undefined, true)).toEqual([])
  })
})

describe('first-run setup', () => {
  it('creates the owner only while the till has none', async () => {
    await db.delete()
    await db.open()
    expect(await needsSetup()).toBe(true)
    const id = await createOwner('Jane Wanjiru', '582193')
    const owner = (await db.users.get(id))!
    expect(owner.role).toBe('owner')
    expect(owner).not.toHaveProperty('pin')
    expect(verifyPin('582193', owner.pinHash)).toBe(true)
    expect(await needsSetup()).toBe(false)
    await expect(createOwner('Intruder', '111999')).rejects.toThrow(/already has an owner/)
  })
})

describe('production migration (v2 → v3)', () => {
  it('archives and clears demo data, hashes PINs and removes default accounts', async () => {
    const name = 'migration-test'
    await Dexie.delete(name)
    const old = new Dexie(name)
    old.version(1).stores({
      users: '++id, pin, role',
      categories: '++id, name',
      suppliers: '++id, name',
      products: '++id, &sku, barcode, name, categoryId, partNumber, *fitment, supplierId, active',
      customers: '++id, name, phone, plate, balance',
      sales: '++id, &receiptNo, createdAt, customerId, userId, shiftId, status',
      parked: '++id, createdAt',
      movements: '++id, productId, at, reason',
      purchaseOrders: '++id, &poNo, supplierId, status, createdAt',
      shifts: '++id, userId, openedAt, closedAt',
      jobs: '++id, &jobNo, customerId, status, createdAt',
      kv: 'key',
    })
    old.version(2).stores({ logs: '++id, at, kind, userId' })
    await old.open()
    await old.table('users').bulkAdd([
      { name: 'Owner', pin: '1234', role: 'owner', active: true },
      { name: 'Cashier', pin: '0000', role: 'cashier', active: true },
      { name: 'Peter', pin: '4821', role: 'manager', active: true },
      { name: 'Mary', pin: '1111', role: 'cashier', active: true },
    ])
    await old.table('products').add({ sku: 'EG01309020', name: 'Left handle switch', fitment: [], cost: 65000, price: 0, stock: 0 })
    await old.table('sales').add({ receiptNo: 'R-000001', createdAt: 1, lines: [], total: 100 })
    await old.table('kv').bulkPut([
      { key: 'seq:R', value: 7 },
      { key: 'settings', value: { shopName: 'Kept Shop' } },
    ])
    old.close()

    const upgraded = new PosDB(name)
    await upgraded.open()
    expect(await upgraded.products.count()).toBe(0)
    expect(await upgraded.sales.count()).toBe(0)
    expect(await upgraded.kv.get('seq:R')).toBeUndefined()
    expect((await upgraded.kv.get('settings'))!.value).toEqual({ shopName: 'Kept Shop' })

    const archive = (await upgraded.kv.get(PRE_PRODUCTION_ARCHIVE))!.value as { data: Record<string, unknown[]> }
    expect(archive.data.products).toHaveLength(1)
    expect(archive.data.sales).toHaveLength(1)

    const users = await upgraded.users.toArray()
    expect(users.map((u) => u.name).sort()).toEqual(['Mary', 'Peter'])
    for (const u of users) expect(u).not.toHaveProperty('pin')
    const peter = users.find((u) => u.name === 'Peter')!
    const mary = users.find((u) => u.name === 'Mary')!
    expect(verifyPin('4821', peter.pinHash)).toBe(true)
    expect(peter.mustChangePin).toBeUndefined()
    expect(mary.mustChangePin).toBe(true) // 1111 is too weak
    upgraded.close()
    await Dexie.delete(name)
  })

  it('v3 → v4: gives stock a movement baseline and queues existing data for upload', async () => {
    const name = 'migration-v4-test'
    await Dexie.delete(name)
    const v3 = new Dexie(name)
    v3.version(3).stores({
      users: '++id, role',
      categories: '++id, name',
      suppliers: '++id, name',
      products: '++id, &sku, barcode, name, categoryId, partNumber, *fitment, supplierId, active',
      customers: '++id, name, phone, plate, balance',
      sales: '++id, &receiptNo, createdAt, customerId, userId, shiftId, status',
      parked: '++id, createdAt',
      movements: '++id, productId, at, reason',
      purchaseOrders: '++id, &poNo, supplierId, status, createdAt',
      shifts: '++id, userId, openedAt, closedAt',
      jobs: '++id, &jobNo, customerId, status, createdAt',
      logs: '++id, at, kind, userId',
      units: '++id, &serial, productId, status, saleId',
      kv: 'key',
    })
    await v3.open()
    await v3.table('products').bulkAdd([
      { id: 1, sku: 'A', name: 'Opening stock part', fitment: [], stock: 4, trackStock: true },
      { id: 2, sku: 'B', name: 'CSV part', fitment: [], stock: 7, trackStock: true },
      { id: 3, sku: 'L', name: 'Labour', fitment: [], stock: 0, trackStock: false },
    ])
    await v3.table('movements').add({ productId: 1, change: 4, reason: 'count', at: 1 })
    await v3.table('kv').bulkPut([{ key: 'settings', value: { shopName: 'S' } }, { key: 'seq:R', value: 3 }])
    v3.close()

    const up = new PosDB(name)
    await up.open()
    const moves = await up.movements.where('productId').equals(2).toArray()
    expect(moves.map((m) => m.change)).toEqual([7])
    expect(await up.movements.where('productId').equals(1).count()).toBe(1)
    const queued = (await up.outbox.toArray()).map((e) => e.id)
    expect(queued).toContain('products|1')
    expect(queued).toContain('kv|"settings"')
    expect(queued).not.toContain('kv|"seq:R"')
    expect(queued.filter((q) => q.startsWith('movements|'))).toHaveLength(2)
    up.close()
    await Dexie.delete(name)
  })
})
