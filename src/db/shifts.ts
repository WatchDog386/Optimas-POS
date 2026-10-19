import { db } from './db'
import type { PaymentMethod, Sale, Shift } from './types'

export async function currentShift(): Promise<Shift | undefined> {
  return db.shifts.filter((s) => !s.closedAt).last()
}

export async function openShift(userId: number, openingFloat: number): Promise<Shift> {
  const existing = await currentShift()
  if (existing) return existing
  const shift: Shift = { userId, openedAt: Date.now(), openingFloat, cashMovements: [] }
  shift.id = await db.shifts.add(shift)
  return shift
}

export async function addCashMovement(shiftId: number, type: 'in' | 'out', amount: number, reason: string) {
  const s = await db.shifts.get(shiftId)
  if (!s) return
  await db.shifts.update(shiftId, { cashMovements: [...s.cashMovements, { type, amount, reason, at: Date.now() }] })
}

export interface ShiftSummary {
  sales: number
  refunds: number
  transactions: number
  byMethod: Record<PaymentMethod, number>
  cashIn: number
  cashOut: number
  expectedCash: number
  tax: number
}

export function summarizeShift(shift: Shift, sales: Sale[]): ShiftSummary {
  const byMethod: Record<PaymentMethod, number> = { cash: 0, mpesa: 0, card: 0, account: 0 }
  let total = 0
  let refunds = 0
  let tax = 0
  let transactions = 0
  for (const sale of sales) {
    if (sale.status === 'voided') continue
    if (sale.total < 0) refunds += -sale.total
    else {
      total += sale.total
      transactions++
    }
    tax += sale.tax
    for (const p of sale.payments) byMethod[p.method] += p.amount
    byMethod.cash -= sale.change
  }
  const cashIn = shift.cashMovements.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0)
  const cashOut = shift.cashMovements.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0)
  return {
    sales: total,
    refunds,
    transactions,
    byMethod,
    cashIn,
    cashOut,
    tax,
    expectedCash: shift.openingFloat + byMethod.cash + cashIn - cashOut,
  }
}

export async function closeShift(shiftId: number, countedCash: number, notes?: string): Promise<ShiftSummary> {
  const shift = await db.shifts.get(shiftId)
  if (!shift) throw new Error('Shift not found')
  const sales = await db.sales.where('shiftId').equals(shiftId).toArray()
  const summary = summarizeShift(shift, sales)
  await db.shifts.update(shiftId, {
    closedAt: Date.now(),
    countedCash,
    expectedCash: summary.expectedCash,
    notes,
  })
  return summary
}
