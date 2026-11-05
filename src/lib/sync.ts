// Two-way sync between the till's IndexedDB (source of truth for day-to-day use)
// and the central server (/api/products, /api/sales). Used so the installed till
// and the web share the same stock and sales.
// Conflict resolution: last-write-wins by timestamp — products on `updatedAt`,
// sales on `createdAt`/`updated_at`.

import { db } from '../db/db'
import type { Product, Sale } from '../db/types'

type ServerProduct = {
  id: number
  sku: string
  barcode: string | null
  name: string
  category_id: number | null
  brand: string | null
  part_number: string | null
  cost: number
  price: number
  stock: number
  reorder_level: number
  active: number
  updated_at: number
}

type ServerSale = {
  id: number
  receiptNo: string
  createdAt: number
  lines: unknown
  subtotal: number
  discount: number
  tax: number
  total: number
  payments: unknown
  change: number
  customerId: number | null
  userId: number
  shiftId: number | null
  status: string
  note: string | null
  refundOf: number | null
  updatedAt: number
}

export interface SyncResult {
  pushedProducts: number
  pushedSales: number
  pulledProducts: number
  pulledSales: number
  errors: string[]
}

function apiBase(apiUrl: string): string {
  return apiUrl.replace(/\/$/, '')
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ Push */

export async function pushProducts(apiUrl: string): Promise<{ ok: number; errors: string[] }> {
  const products = await db.products.toArray()
  let ok = 0
  const errors: string[] = []
  const base = apiBase(apiUrl)
  for (const p of products) {
    try {
      await json(`${base}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: p.sku,
          barcode: p.barcode ?? null,
          name: p.name,
          category_id: p.categoryId ?? null,
          brand: p.brand ?? null,
          part_number: p.partNumber ?? null,
          cost: p.cost,
          price: p.price,
          stock: p.stock,
          reorder_level: p.reorderLevel,
          active: p.active ? 1 : 0,
        }),
      })
      ok++
    } catch (e) {
      errors.push(`product ${p.sku}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { ok, errors }
}

export async function pushSales(apiUrl: string): Promise<{ ok: number; errors: number[] }> {
  const sales = await db.sales.toArray()
  let ok = 0
  const errors: number[] = []
  const base = apiBase(apiUrl)
  for (const s of sales) {
    try {
      await json(`${base}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptNo: s.receiptNo,
          createdAt: s.createdAt,
          lines: s.lines,
          subtotal: s.subtotal,
          discount: s.discount,
          tax: s.tax,
          total: s.total,
          payments: s.payments,
          change: s.change,
          customerId: s.customerId,
          userId: s.userId,
          shiftId: s.shiftId,
          status: s.status,
          note: s.note,
          refundOf: s.refundOf,
          updatedAt: s.createdAt,
        }),
      })
      ok++
    } catch (e) {
      errors.push(s.id ?? -1)
    }
  }
  return { ok, errors }
}

/* ------------------------------------------------------------------ Pull */

function serverProductToLocal(sp: ServerProduct): Partial<Product> {
  return {
    sku: sp.sku,
    barcode: sp.barcode ?? undefined,
    name: sp.name,
    categoryId: sp.category_id ?? undefined,
    brand: sp.brand ?? undefined,
    partNumber: sp.part_number ?? undefined,
    fitment: [],
    cost: sp.cost,
    price: sp.price,
    stock: sp.stock,
    reorderLevel: sp.reorder_level,
    supplierId: undefined,
    location: undefined,
    image: undefined,
    taxable: true,
    serialized: false,
    trackStock: true,
    active: sp.active !== 0,
    createdAt: sp.updated_at,
    updatedAt: sp.updated_at,
  }
}

export async function pullProducts(apiUrl: string): Promise<{ ok: number; errors: string[] }> {
  const base = apiBase(apiUrl)
  const server = (await json<ServerProduct[]>(`${base}/products`)).sort(
    (a, b) => b.updated_at - a.updated_at
  )
  const bySku = new Map(
    (await db.products.toArray()).map((p) => [p.sku, p] as [string, Product])
  )
  let ok = 0
  const errors: string[] = []
  await db.transaction('rw', db.products, async () => {
    for (const sp of server) {
      try {
        const local = bySku.get(sp.sku)
        const incoming: Partial<Product> = {
          ...serverProductToLocal(sp),
          updatedAt: sp.updated_at,
        }
        if (local) {
          // Last-write-wins: only overwrite when the server copy is newer.
          if (sp.updated_at > (local.updatedAt ?? 0)) {
            // Preserve local-only fields the server doesn't store.
            const keep: Partial<Product> = {
              fitment: local.fitment,
              image: local.image,
              supplierId: local.supplierId,
              location: local.location,
              taxable: local.taxable,
              serialized: local.serialized,
              trackStock: local.trackStock,
              createdAt: local.createdAt,
            }
            await db.products.update(local.id!, { ...incoming, ...keep })
            ok++
          }
        } else {
          await db.products.add(serverProductToLocal(sp) as Product)
          bySku.set(sp.sku, serverProductToLocal(sp) as Product)
          ok++
        }
      } catch (e) {
        errors.push(`product ${sp.sku}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  })
  return { ok, errors }
}

export async function pullSales(apiUrl: string): Promise<{ ok: number; errors: string[] }> {
  const base = apiBase(apiUrl)
  const server = (await json<ServerSale[]>(`${base}/sales`)).sort(
    (a, b) => b.updatedAt - a.updatedAt
  )
  const byReceipt = new Map(
    (await db.sales.toArray()).map((s) => [s.receiptNo, s] as [string, Sale])
  )
  let ok = 0
  const errors: string[] = []
  await db.transaction('rw', db.sales, async () => {
    for (const ss of server) {
      try {
        const local = byReceipt.get(ss.receiptNo)
        if (!local) {
          await db.sales.add({
            id: ss.id,
            receiptNo: ss.receiptNo,
            createdAt: ss.createdAt,
            lines: ss.lines as Sale['lines'],
            subtotal: ss.subtotal,
            discount: ss.discount,
            tax: ss.tax,
            total: ss.total,
            payments: ss.payments as Sale['payments'],
            change: ss.change,
            customerId: ss.customerId,
            userId: ss.userId,
            shiftId: ss.shiftId,
            status: ss.status as Sale['status'],
            note: ss.note,
            refundOf: ss.refundOf,
          } as Sale)
          ok++
        } else if (ss.updatedAt > local.createdAt) {
          await db.sales.update(local.id!, {
            lines: ss.lines as Sale['lines'],
            subtotal: ss.subtotal,
            discount: ss.discount,
            tax: ss.tax,
            total: ss.total,
            payments: ss.payments as Sale['payments'],
            change: ss.change,
            customerId: ss.customerId ?? undefined,
            userId: ss.userId,
            shiftId: ss.shiftId ?? undefined,
            status: ss.status as Sale['status'],
            note: ss.note ?? undefined,
            refundOf: ss.refundOf ?? undefined,
          })
          ok++
        }
      } catch (e) {
        errors.push(`sale ${ss.receiptNo}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  })
  return { ok, errors }
}

/* ------------------------------------------------------------------ Full sync */

export async function syncAll(apiUrl: string): Promise<SyncResult> {
  const result: SyncResult = { pushedProducts: 0, pushedSales: 0, pulledProducts: 0, pulledSales: 0, errors: [] }

  const pushP = await pushProducts(apiUrl)
  result.pushedProducts = pushP.ok
  result.errors.push(...pushP.errors)

  const pushS = await pushSales(apiUrl)
  result.pushedSales = pushS.ok
  result.errors.push(...pushS.errors.map((id) => `sale ${id}: failed to push`))

  const pullP = await pullProducts(apiUrl)
  result.pulledProducts = pullP.ok
  result.errors.push(...pullP.errors)

  const pullS = await pullSales(apiUrl)
  result.pulledSales = pullS.ok
  result.errors.push(...pullS.errors)

  return result
}
