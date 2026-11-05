import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { completeSale, refundSale, SaleError } from '../db/sales'
import { closeShift, openShift } from '../db/shifts'
import { draftReorder, receivePurchaseOrder } from '../db/purchasing'
import { lineFor, seedTestData } from './fixtures'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await seedTestData()
})

describe('sales', () => {
  it('completes a sale, deducts stock and numbers receipts', async () => {
    const pads = (await db.products.where('sku').equals('BRK-PAD-F').first())!
    const sale = await completeSale({ lines: [lineFor(pads, 2)], discount: 0, payments: [{ method: 'cash', amount: 2_000_00 }], userId: 1 })
    expect(sale.receiptNo).toMatch(/^R\d{2}-000001$/)
    expect(sale.total).toBe(1_700_00)
    expect(sale.change).toBe(300_00)
    expect((await db.products.get(pads.id!))!.stock).toBe(pads.stock - 2)
    expect(await db.movements.where('productId').equals(pads.id!).count()).toBe(1)
  })

  it('does not touch stock for labour', async () => {
    const labour = (await db.products.where('sku').equals('LAB-FIT').first())!
    await completeSale({ lines: [lineFor(labour)], discount: 0, payments: [{ method: 'mpesa', amount: 300_00, reference: 'ABC1234567' }], userId: 1 })
    expect((await db.products.get(labour.id!))!.stock).toBe(0)
  })

  it('rejects underpayment and enforces credit limits', async () => {
    const helmet = (await db.products.where('sku').equals('ACC-HLM').first())!
    await expect(completeSale({ lines: [lineFor(helmet)], discount: 0, payments: [{ method: 'cash', amount: 100 }], userId: 1 })).rejects.toThrow(SaleError)
    const fleet = (await db.customers.where('name').startsWith('Boda').first())!
    const ctrl = (await db.products.where('sku').equals('ELC-CTRL').first())!
    await expect(
      completeSale({ lines: [lineFor(ctrl, 3)], discount: 0, payments: [{ method: 'account', amount: 63_000_00 }], customerId: fleet.id, userId: 1 }),
    ).rejects.toThrow(/Credit limit/)
    await completeSale({ lines: [lineFor(helmet)], discount: 0, payments: [{ method: 'account', amount: 3_000_00 }], customerId: fleet.id, userId: 1 })
    expect((await db.customers.get(fleet.id!))!.balance).toBe(3_000_00)
  })

  it('partially refunds and restocks', async () => {
    const tube = (await db.products.where('sku').equals('TUB-17').first())!
    const sale = await completeSale({ lines: [lineFor(tube, 3)], discount: 0, payments: [{ method: 'cash', amount: 1_950_00 }], userId: 1 })
    const refund = await refundSale(sale.id!, { qtyByLine: { 0: 1 }, restock: true, method: 'cash', userId: 1 })
    expect(refund.total).toBe(-650_00)
    expect((await db.sales.get(sale.id!))!.status).toBe('partially_refunded')
    expect((await db.products.get(tube.id!))!.stock).toBe(tube.stock - 2)
    await expect(refundSale(sale.id!, { qtyByLine: { 0: 3 }, restock: true, method: 'cash', userId: 1 })).rejects.toThrow(/Only 2/)
    await refundSale(sale.id!, { qtyByLine: { 0: 2 }, restock: false, method: 'cash', userId: 1 })
    expect((await db.sales.get(sale.id!))!.status).toBe('refunded')
  })
})

describe('shifts', () => {
  it('computes expected cash net of change and refunds', async () => {
    const shift = await openShift(1, 5_000_00)
    const tube = (await db.products.where('sku').equals('TUB-17').first())!
    const sale = await completeSale({ lines: [lineFor(tube, 2)], discount: 0, payments: [{ method: 'cash', amount: 2_000_00 }], userId: 1, shiftId: shift.id })
    await completeSale({ lines: [lineFor(tube)], discount: 0, payments: [{ method: 'mpesa', amount: 650_00, reference: 'QWE1234567' }], userId: 1, shiftId: shift.id })
    await refundSale(sale.id!, { qtyByLine: { 0: 1 }, restock: true, method: 'cash', userId: 1, shiftId: shift.id })
    const summary = await closeShift(shift.id!, 5_650_00)
    expect(summary.byMethod.cash).toBe(650_00)
    expect(summary.byMethod.mpesa).toBe(650_00)
    expect(summary.expectedCash).toBe(5_650_00)
  })
})

describe('purchasing', () => {
  it('drafts a reorder for low stock and receives it', async () => {
    const lever = (await db.products.where('sku').equals('BRK-LEV-L').first())!
    await db.products.update(lever.id!, { stock: 1 })
    const po = (await draftReorder())!
    const idx = po.lines.findIndex((l) => l.productId === lever.id)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(po.lines[idx].qty).toBe(lever.reorderLevel * 2 - 1)
    await receivePurchaseOrder(po.id!, { [idx]: po.lines[idx].qty })
    expect((await db.products.get(lever.id!))!.stock).toBe(lever.reorderLevel * 2)
    expect((await db.purchaseOrders.get(po.id!))!.status).toBe('partial')
  })
})
