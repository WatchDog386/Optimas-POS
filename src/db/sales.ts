import { db } from './db'
import { getSettings, nextNumber } from './settings'
import { changeDue, computeTotals, paidAmount } from '../lib/cart'
import type { Payment, Sale, SaleLine } from './types'

export class SaleError extends Error {}

export interface CheckoutInput {
  lines: SaleLine[]
  discount: number
  payments: Payment[]
  customerId?: number
  userId: number
  shiftId?: number
  note?: string
}

/**
 * Complete a sale atomically: write the sale, deduct stock, log stock movements and
 * post any on-account amount to the customer's balance.
 */
export async function completeSale(input: CheckoutInput): Promise<Sale> {
  if (input.lines.length === 0) throw new SaleError('Cart is empty')
  const settings = await getSettings()
  const totals = computeTotals(input.lines, input.discount, settings.vatRate, settings.pricesIncludeVat)
  const paid = paidAmount(input.payments)
  if (paid < totals.total) throw new SaleError('Payment does not cover the total')

  const onAccount = input.payments.filter((p) => p.method === 'account').reduce((s, p) => s + p.amount, 0)
  if (onAccount > 0 && !input.customerId) throw new SaleError('Select a customer to sell on account')

  return db.transaction('rw', [db.sales, db.products, db.movements, db.customers, db.kv], async () => {
    if (onAccount > 0) {
      const customer = await db.customers.get(input.customerId!)
      if (!customer) throw new SaleError('Customer not found')
      if (customer.creditLimit > 0 && customer.balance + onAccount > customer.creditLimit) {
        throw new SaleError(`Credit limit exceeded for ${customer.name}`)
      }
      await db.customers.update(customer.id!, { balance: customer.balance + onAccount })
    }

    const now = Date.now()
    const receiptNo = await nextNumber('R')
    const sale: Sale = {
      receiptNo,
      createdAt: now,
      lines: input.lines.map((l) => ({ ...l })),
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
      payments: input.payments,
      change: changeDue(totals.total, input.payments),
      customerId: input.customerId,
      userId: input.userId,
      shiftId: input.shiftId,
      status: 'completed',
      note: input.note,
    }
    sale.id = await db.sales.add(sale)

    for (const line of input.lines) {
      if (!line.productId) continue
      const product = await db.products.get(line.productId)
      if (!product || !product.trackStock) continue
      await db.products.update(product.id!, { stock: product.stock - line.qty, updatedAt: now })
      await db.movements.add({
        productId: product.id!,
        change: -line.qty,
        reason: 'sale',
        reference: receiptNo,
        userId: input.userId,
        at: now,
      })
    }
    return sale
  })
}

export interface RefundRequest {
  /** Quantity to refund per line index of the original sale. */
  qtyByLine: Record<number, number>
  restock: boolean
  method: Payment['method']
  userId: number
  shiftId?: number
  reason?: string
}

/** Refund some or all lines of a sale. Creates a negative sale record for reporting. */
export async function refundSale(saleId: number, req: RefundRequest): Promise<Sale> {
  const settings = await getSettings()
  return db.transaction('rw', [db.sales, db.products, db.movements, db.customers, db.kv], async () => {
    const original = await db.sales.get(saleId)
    if (!original) throw new SaleError('Sale not found')
    if (original.refundOf) throw new SaleError('Cannot refund a refund')

    const refundLines: SaleLine[] = []
    const updatedLines = original.lines.map((l) => ({ ...l }))
    for (const [idxStr, qty] of Object.entries(req.qtyByLine)) {
      const idx = Number(idxStr)
      const line = updatedLines[idx]
      if (!line || qty <= 0) continue
      const available = line.qty - (line.refundedQty ?? 0)
      if (qty > available) throw new SaleError(`Only ${available} of ${line.name} can be refunded`)
      line.refundedQty = (line.refundedQty ?? 0) + qty
      // Pro-rate the line discount by refunded quantity.
      refundLines.push({ ...line, qty, discount: Math.round((line.discount * qty) / line.qty), refundedQty: undefined })
    }
    if (refundLines.length === 0) throw new SaleError('Nothing selected to refund')

    // Pro-rate the cart discount by the share of the original subtotal being refunded.
    const refundGross = refundLines.reduce((s, l) => s + l.qty * l.unitPrice - l.discount, 0)
    const cartDiscount = original.subtotal ? Math.round((original.discount * refundGross) / original.subtotal) : 0
    const totals = computeTotals(refundLines, cartDiscount, settings.vatRate, settings.pricesIncludeVat)

    const now = Date.now()
    const receiptNo = await nextNumber('RF')
    const refund: Sale = {
      receiptNo,
      createdAt: now,
      lines: refundLines.map((l) => ({ ...l, qty: -l.qty, discount: -l.discount })),
      subtotal: -totals.subtotal,
      discount: -totals.discount,
      tax: -totals.tax,
      total: -totals.total,
      payments: [{ method: req.method, amount: -totals.total }],
      change: 0,
      customerId: original.customerId,
      userId: req.userId,
      shiftId: req.shiftId,
      status: 'completed',
      note: req.reason,
      refundOf: original.id,
    }
    refund.id = await db.sales.add(refund)

    const fullyRefunded = updatedLines.every((l) => (l.refundedQty ?? 0) >= l.qty)
    await db.sales.update(original.id!, {
      lines: updatedLines,
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
    })

    if (req.method === 'account' && original.customerId) {
      const c = await db.customers.get(original.customerId)
      if (c) await db.customers.update(c.id!, { balance: c.balance - totals.total })
    }

    if (req.restock) {
      for (const line of refundLines) {
        if (!line.productId) continue
        const p = await db.products.get(line.productId)
        if (!p || !p.trackStock) continue
        await db.products.update(p.id!, { stock: p.stock + line.qty, updatedAt: now })
        await db.movements.add({ productId: p.id!, change: line.qty, reason: 'refund', reference: receiptNo, userId: req.userId, at: now })
      }
    }
    return refund
  })
}

export async function adjustStock(
  productId: number,
  change: number,
  reason: 'adjust' | 'damage' | 'count' | 'receive',
  userId?: number,
  note?: string,
  reference?: string,
): Promise<void> {
  await db.transaction('rw', db.products, db.movements, async () => {
    const p = await db.products.get(productId)
    if (!p) throw new SaleError('Product not found')
    await db.products.update(productId, { stock: p.stock + change, updatedAt: Date.now() })
    await db.movements.add({ productId, change, reason, note, reference, userId, at: Date.now() })
  })
}

/** Record a payment against a customer's account balance. */
export async function receiveAccountPayment(customerId: number, amount: number): Promise<void> {
  await db.transaction('rw', db.customers, async () => {
    const c = await db.customers.get(customerId)
    if (!c) throw new SaleError('Customer not found')
    await db.customers.update(customerId, { balance: c.balance - amount })
  })
}
