import { db } from './db'
import { nextNumber } from './settings'
import type { PurchaseOrder, PurchaseOrderLine } from './types'

/** Draft a purchase order for every active product at or below its reorder level. */
export async function draftReorder(supplierId?: number): Promise<PurchaseOrder | undefined> {
  const low = await db.products
    .filter((p) => p.active && p.stock <= p.reorderLevel && (supplierId === undefined || p.supplierId === supplierId))
    .toArray()
  if (low.length === 0) return undefined
  const lines: PurchaseOrderLine[] = low.map((p) => ({
    productId: p.id!,
    // Order back up to twice the reorder level.
    qty: Math.max(1, p.reorderLevel * 2 - p.stock),
    unitCost: p.cost,
    received: 0,
  }))
  return createPurchaseOrder(lines, supplierId)
}

export async function createPurchaseOrder(lines: PurchaseOrderLine[], supplierId?: number, notes?: string) {
  return db.transaction('rw', db.purchaseOrders, db.kv, async () => {
    const now = Date.now()
    const po: PurchaseOrder = {
      poNo: await nextNumber('PO'),
      supplierId,
      lines,
      status: 'draft',
      notes,
      createdAt: now,
      updatedAt: now,
    }
    po.id = await db.purchaseOrders.add(po)
    return po
  })
}

/** Receive quantities against a PO: stock goes up, cost price updates to the latest landed cost. */
export async function receivePurchaseOrder(poId: number, receivedByLine: Record<number, number>, userId?: number) {
  await db.transaction('rw', [db.purchaseOrders, db.products, db.movements], async () => {
    const po = await db.purchaseOrders.get(poId)
    if (!po) throw new Error('Purchase order not found')
    const now = Date.now()
    const lines = po.lines.map((l) => ({ ...l }))
    for (const [idxStr, qty] of Object.entries(receivedByLine)) {
      const line = lines[Number(idxStr)]
      if (!line || qty <= 0) continue
      line.received += qty
      const p = await db.products.get(line.productId)
      if (!p) continue
      await db.products.update(p.id!, { stock: p.stock + qty, cost: line.unitCost, updatedAt: now })
      await db.movements.add({ productId: p.id!, change: qty, reason: 'receive', reference: po.poNo, userId, at: now })
    }
    const done = lines.every((l) => l.received >= l.qty)
    const any = lines.some((l) => l.received > 0)
    await db.purchaseOrders.update(poId, { lines, status: done ? 'received' : any ? 'partial' : po.status, updatedAt: now })
  })
}
