// Getting lost parts back.
//
//  - Recycle bin: every deleted part (with its stock history and serial labels)
//    is kept on this till for restore. Stored in the local key/value table,
//    which is not synced.
//  - Orphans: serial labels / stock movements whose part is missing (e.g. the
//    part was deleted on another till) can be rebuilt into a part again, with
//    the same record ID so every till and the server agree.

import { db } from './db'
import { nextNumber } from '../lib/partCodes'
import type { Product, StockMovement, StockUnit } from './types'

const TRASH_KEY = 'trash:parts'
const TRASH_MAX = 500

export interface TrashEntry {
  deletedAt: number
  deletedBy?: string
  product: Product
  units: StockUnit[]
  movements: StockMovement[]
}

/** Snapshot parts before they are deleted. Call inside the deleting transaction (needs products, units, movements, kv). */
export async function trashProducts(ids: number[], deletedBy?: string): Promise<void> {
  if (!ids.length) return
  const entries: TrashEntry[] = []
  for (const id of ids) {
    const product = await db.products.get(id)
    if (!product) continue
    entries.push({
      deletedAt: Date.now(),
      deletedBy,
      product,
      units: await db.units.where('productId').equals(id).toArray(),
      movements: await db.movements.where('productId').equals(id).toArray(),
    })
  }
  const row = await db.kv.get(TRASH_KEY)
  const all = [...entries, ...((row?.value as TrashEntry[]) ?? [])].slice(0, TRASH_MAX)
  await db.kv.put({ key: TRASH_KEY, value: all })
}

export async function listTrash(): Promise<TrashEntry[]> {
  return ((await db.kv.get(TRASH_KEY))?.value as TrashEntry[]) ?? []
}

/** Put deleted parts back exactly as they were (same IDs, labels and stock history). */
export async function restoreFromTrash(productIds: number[]): Promise<number> {
  const want = new Set(productIds)
  let restored = 0
  await db.transaction('rw', [db.products, db.units, db.movements, db.kv], async () => {
    const all = await listTrash()
    const keep: TrashEntry[] = []
    for (const e of all) {
      if (!want.has(e.product.id!) || (await db.products.get(e.product.id!))) {
        keep.push(e)
        continue
      }
      await putProduct(e.product)
      for (const m of e.movements) if (!(await db.movements.get(m.id!))) await db.movements.add(m)
      for (const u of e.units) if (!(await db.units.where('serial').equals(u.serial).first())) await db.units.add(u)
      const stock = e.movements.reduce((a, m) => a + m.change, 0)
      if (e.product.trackStock) await db.products.update(e.product.id!, { stock, updatedAt: Date.now() })
      want.delete(e.product.id!)
      restored++
    }
    await db.kv.put({ key: TRASH_KEY, value: keep })
  })
  return restored
}

/** Add a product, renaming its SKU if another part took it meanwhile. */
async function putProduct(p: Product) {
  let sku = p.sku
  const clash = await db.products.where('sku').equals(sku).first()
  if (clash && clash.id !== p.id) sku = nextNumber((await db.products.toArray()).map((x) => x.sku))
  await db.products.put({ ...p, sku, updatedAt: Date.now() })
}

export interface Orphan {
  productId: number
  units: StockUnit[]
  movements: StockMovement[]
}

/** Serial labels and stock movements that point at a part this till doesn't have. */
export async function findOrphans(): Promise<Orphan[]> {
  const ids = new Set((await db.products.toCollection().primaryKeys()) as number[])
  const map = new Map<number, Orphan>()
  const get = (id: number) => map.get(id) ?? (map.set(id, { productId: id, units: [], movements: [] }), map.get(id)!)
  await db.units.each((u) => void (ids.has(u.productId) || get(u.productId).units.push(u)))
  await db.movements.each((m) => void (ids.has(m.productId) || get(m.productId).movements.push(m)))
  return [...map.values()].filter((o) => o.units.length > 0)
}

/**
 * Rebuild a part for each orphan group, keeping its record ID so its labels
 * scan again. The part is created inactive with no price — open it, enter the
 * name and price, and activate it.
 */
export async function rebuildOrphans(orphans: Orphan[]): Promise<number> {
  let n = 0
  await db.transaction('rw', [db.products, db.movements, db.units], async () => {
    for (const o of orphans) {
      if (await db.products.get(o.productId)) continue
      const now = Date.now()
      const inStock = o.units.filter((u) => u.status === 'in_stock').length
      const fromMovements = o.movements.reduce((a, m) => a + m.change, 0)
      const sku = nextNumber((await db.products.toArray()).map((x) => x.sku))
      await db.products.put({
        id: o.productId,
        sku,
        name: `Recovered part (${o.units[0].serial})`,
        fitment: [],
        cost: 0,
        price: 0,
        stock: o.movements.length ? fromMovements : inStock,
        reorderLevel: 2,
        taxable: true,
        serialized: false,
        trackStock: true,
        active: false,
        createdAt: Math.min(...o.units.map((u) => u.createdAt)),
        updatedAt: now,
      } as Product)
      if (!o.movements.length && inStock) await db.movements.add({ productId: o.productId, change: inStock, reason: 'count', note: 'Recovered from serial labels', at: now })
      n++
    }
  })
  return n
}
