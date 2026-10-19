import { describe, expect, it } from 'vitest'
import { changeDue, computeTotals, quickCashOptions } from '../lib/cart'
import type { SaleLine } from '../db/types'

const line = (unitPrice: number, qty = 1, extra: Partial<SaleLine> = {}): SaleLine => ({
  name: 'x',
  qty,
  unitPrice,
  unitCost: 0,
  discount: 0,
  taxable: true,
  ...extra,
})

describe('computeTotals', () => {
  it('extracts VAT from VAT-inclusive prices', () => {
    const t = computeTotals([line(116_00)], 0, 16, true)
    expect(t.total).toBe(116_00)
    expect(t.tax).toBe(16_00)
  })

  it('adds VAT on top when prices exclude it', () => {
    const t = computeTotals([line(100_00, 2)], 0, 16, false)
    expect(t.subtotal).toBe(200_00)
    expect(t.tax).toBe(32_00)
    expect(t.total).toBe(232_00)
  })

  it('spreads the cart discount before taxing and skips exempt lines', () => {
    const t = computeTotals([line(116_00), line(100_00, 1, { taxable: false })], 21_60, 16, true)
    expect(t.total).toBe(194_40)
    // Taxable share of the discount is 116/216 of 21.60 = 11.60, so VAT is on 104.40.
    expect(t.tax).toBe(14_40)
  })

  it('caps the discount at the subtotal and applies line discounts', () => {
    const t = computeTotals([line(50_00, 2, { discount: 10_00 })], 1_000_00, 16, true)
    expect(t.subtotal).toBe(90_00)
    expect(t.total).toBe(0)
  })
})

describe('payments', () => {
  it('only gives change out of cash', () => {
    expect(changeDue(100_00, [{ method: 'cash', amount: 200_00 }])).toBe(100_00)
    expect(changeDue(100_00, [{ method: 'mpesa', amount: 60_00 }, { method: 'cash', amount: 50_00 }])).toBe(10_00)
    expect(changeDue(100_00, [{ method: 'mpesa', amount: 100_00 }])).toBe(0)
  })

  it('suggests sensible note amounts', () => {
    expect(quickCashOptions(1_730_00)).toEqual([1_730_00, 1_750_00, 1_800_00, 2_000_00])
    expect(quickCashOptions(0)).toEqual([])
  })
})
