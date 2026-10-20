import type { Payment, SaleLine } from '../db/types'

export interface Totals {
  subtotal: number
  discount: number
  tax: number
  total: number
  itemCount: number
}

export function lineTotal(line: SaleLine): number {
  return Math.max(0, line.qty * line.unitPrice - line.discount)
}

/**
 * Compute cart totals. The cart-level discount is spread over lines in proportion
 * to their value so VAT is only charged on what the customer actually pays.
 */
export function computeTotals(
  lines: SaleLine[],
  cartDiscount: number,
  vatRate: number,
  pricesIncludeVat: boolean,
): Totals {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0)
  const discount = Math.min(Math.max(0, cartDiscount), subtotal)
  const taxableGross = lines.filter((l) => l.taxable).reduce((s, l) => s + lineTotal(l), 0)
  const taxableNet = subtotal === 0 ? 0 : taxableGross - (discount * taxableGross) / subtotal

  let tax: number
  let total: number
  if (pricesIncludeVat) {
    total = subtotal - discount
    tax = Math.round((taxableNet * vatRate) / (100 + vatRate))
  } else {
    tax = Math.round((taxableNet * vatRate) / 100)
    total = subtotal - discount + tax
  }
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)
  return { subtotal, discount, tax, total, itemCount }
}

export function paidAmount(payments: Payment[]): number {
  return payments.reduce((s, p) => s + p.amount, 0)
}

/** Only cash can be over-tendered; anything above the total is returned as change. */
export function changeDue(total: number, payments: Payment[]): number {
  const paid = paidAmount(payments)
  if (paid <= total) return 0
  const cash = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
  return Math.min(paid - total, cash)
}

/** Suggested cash notes for quick-tender buttons, e.g. total 1,730 -> 1,730 / 1,750 / 2,000 / 5,000. */
export function quickCashOptions(remaining: number): number[] {
  if (remaining <= 0) return []
  const steps = [5000, 10000, 20000, 50000, 100000, 200000, 500000]
  const out = new Set<number>([remaining])
  for (const step of steps) {
    const rounded = Math.ceil(remaining / step) * step
    if (rounded > remaining) out.add(rounded)
    if (out.size >= 4) break
  }
  return [...out].sort((a, b) => a - b).slice(0, 4)
}
