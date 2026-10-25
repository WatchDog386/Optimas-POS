import { db } from './db'
import { currentTill } from './till'
import { getSettings } from './settings'
import { logActivity, userName } from './logs'
import { money } from '../lib/money'
import type { PaymentMethod, Sale, Shift } from './types'

/** An open shift on this till (shifts from other tills arrive through sync). */
export const isOpenHere = (s: Shift) => !s.closedAt && (s.till === undefined || s.till === currentTill())

export async function currentShift(): Promise<Shift | undefined> {
  return db.shifts.filter(isOpenHere).last()
}

export async function openShift(userId: number, openingFloat: number): Promise<Shift> {
  const existing = await currentShift()
  if (existing) return existing
  const shift: Shift = { till: currentTill(), userId, openedAt: Date.now(), openingFloat, cashMovements: [] }
  shift.id = await db.shifts.add(shift)
  const s = await getSettings()
  await logActivity('shift', 'Shift opened', {
    detail: `Float ${money(openingFloat, s.currency)}`,
    userId,
    userName: await userName(userId),
  })
  return shift
}

export async function addCashMovement(shiftId: number, type: 'in' | 'out', amount: number, reason: string) {
  const s0 = await db.shifts.get(shiftId)
  if (!s0) return
  await db.shifts.update(shiftId, { cashMovements: [...s0.cashMovements, { type, amount, reason, at: Date.now() }] })
  const s = await getSettings()
  await logActivity('shift', `Cash ${type === 'in' ? 'in' : 'out'}`, {
    detail: `${money(amount, s.currency)} — ${reason}`,
    userId: s0.userId,
    userName: await userName(s0.userId),
  })
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
  const s = await getSettings()
  const diff = countedCash - summary.expectedCash
  await logActivity('shift', 'Shift closed', {
    detail: `Counted ${money(countedCash, s.currency)} · expected ${money(summary.expectedCash, s.currency)}${
      diff !== 0 ? ` · ${diff > 0 ? '+' : ''}${money(diff, s.currency)}` : ''
    }`,
    userId: shift.userId,
    userName: await userName(shift.userId),
  })
  return summary
}
