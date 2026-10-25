import { db } from './db'
import { inStoreEan13 } from '../lib/barcode'
import { currentTill } from './till'
import type { Product, StockUnit } from './types'

async function nextCounter(key: string): Promise<number> {
  const row = await db.kv.get(key)
  const next = ((row?.value as number) ?? 0) + 1
  await db.kv.put({ key, value: next })
  return next
}

/** This till's number (see till.ts) — part of every barcode it generates. */
const tillNumber = async () => currentTill()

/** A fresh in-store EAN-13 (prefix 20) for a product that came without a barcode. */
export async function nextProductBarcode(): Promise<string> {
  return db.transaction('rw', db.kv, db.products, async () => {
    const till = await tillNumber()
    for (;;) {
      const code = inStoreEan13('20', await nextCounter('seq:barcode:product'), till)
      if (!(await db.products.where('barcode').equals(code).first())) return code
    }
  })
}

/**
 * Create `qty` stock units for a product, each with its own serial barcode
 * (in-store EAN-13, prefix 21). Safe to call inside a transaction that
 * includes db.units and db.kv.
 */
export async function createUnits(productId: number, qty: number, source: string): Promise<StockUnit[]> {
  const count = Math.max(0, Math.floor(qty))
  if (count === 0) return []
  if (count > 5000) throw new Error('Create at most 5,000 labels at a time')
  return db.transaction('rw', db.units, db.kv, async () => {
    const now = Date.now()
    const till = await tillNumber()
    const units: StockUnit[] = []
    while (units.length < count) {
      const serial = inStoreEan13('21', await nextCounter('seq:barcode:unit'), till)
      if (await db.units.where('serial').equals(serial).first()) continue
      units.push({ serial, productId, status: 'in_stock', source, createdAt: now })
    }
    const ids = (await db.units.bulkAdd(units, { allKeys: true })) as number[]
    return units.map((u, i) => ({ ...u, id: ids[i] }))
  })
}

export async function findUnit(serial: string): Promise<StockUnit | undefined> {
  return db.units.where('serial').equals(serial.trim()).first()
}

export async function inStockUnits(productId: number): Promise<StockUnit[]> {
  return db.units.where('productId').equals(productId).filter((u) => u.status === 'in_stock').sortBy('createdAt')
}

/**
 * Units a product still needs so every item on the shelf has a label:
 * stock on hand minus units already labelled and in stock.
 */
export async function unlabelledCount(product: Product): Promise<number> {
  if (!product.trackStock || product.stock <= 0) return 0
  const labelled = await db.units.where('productId').equals(product.id!).filter((u) => u.status === 'in_stock').count()
  return Math.max(0, product.stock - labelled)
}

export async function writeOffUnits(serials: string[]): Promise<void> {
  await db.transaction('rw', db.units, async () => {
    for (const s of serials) {
      const u = await db.units.where('serial').equals(s).first()
      if (u && u.status === 'in_stock') await db.units.update(u.id!, { status: 'written_off' })
    }
  })
}

/**
 * Stock was lowered: cancel the newest labels on the shelf until no more than
 * `stock` labelled units remain in stock. Returns the cancelled serials so the
 * shop can peel those labels off.
 */
export async function cancelSurplusUnits(productId: number, stock: number): Promise<string[]> {
  return db.transaction('rw', db.units, async () => {
    const units = await db.units.where('productId').equals(productId).filter((u) => u.status === 'in_stock').sortBy('createdAt')
    const surplus = units.length - Math.max(0, stock)
    if (surplus <= 0) return []
    const cancel = units.slice(-surplus)
    for (const u of cancel) await db.units.update(u.id!, { status: 'cancelled' })
    return cancel.map((u) => u.serial)
  })
}

export type ScanMatch = { product: Product; serial?: string } | { error: string }

/**
 * Resolve a scanned or typed code at the till: a product barcode / SKU / OEM
 * number, or one unit's serial label (which pins the exact item being sold).
 */
export async function lookupCode(code: string, products: Product[]): Promise<ScanMatch> {
  const c = code.trim()
  if (!c) return { error: 'Nothing scanned' }
  const lower = c.toLowerCase()
  const product = products.find(
    (p) => p.barcode?.toLowerCase() === lower || p.sku.toLowerCase() === lower || p.partNumber?.toLowerCase() === lower,
  )
  if (product) return { product }
  const unit = await findUnit(c)
  if (unit) {
    if (unit.status === 'sold') return { error: `Label ${unit.serial} was already sold on ${unit.receiptNo ?? 'an earlier receipt'}` }
    if (unit.status === 'written_off') return { error: `Label ${unit.serial} was written off as damaged/lost` }
    if (unit.status === 'cancelled') return { error: `Label ${unit.serial} was cancelled when the stock count was lowered — scan another label` }
    const owner = products.find((p) => p.id === unit.productId)
    if (!owner) return { error: `Label ${unit.serial} belongs to a part that is not active for sale` }
    return { product: owner, serial: unit.serial }
  }
  return { error: `No part or label matches ${c}` }
}
