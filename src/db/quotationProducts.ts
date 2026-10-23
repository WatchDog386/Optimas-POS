import { db } from './db'
import type { Product } from './types'

const QUOTE_REFERENCE = 'DO-KE-20261015-000384'
const SUPPLIER_NAME = 'Spiro Optimus'

const QUOTED_PARTS = [
  { sku: 'EG01309020', name: 'Left handle switch', category: 'Electrical', cost: 650, requestedQty: 20 },
  { sku: 'EG01311010', name: 'Left handle switch', category: 'Electrical', cost: 650.91, requestedQty: 20 },
  { sku: 'EG01310020', name: 'Right handle switch', category: 'Electrical', cost: 906, requestedQty: 20 },
  { sku: '14221-QBB1-A000', name: 'Right handlebar grip', category: 'Controls & Handlebar', cost: 151.78, requestedQty: 5 },
  { sku: 'E046401010', name: 'Headlight', category: 'Lighting', cost: 1892, requestedQty: 2 },
  { sku: '1410A-QBB1-A000', name: 'Lock assembly', category: 'Body & Panels', cost: 1646, requestedQty: 3 },
  { sku: '16100-QBE3-A000', name: 'Display', category: 'Electrical', cost: 2352.39, requestedQty: 1 },
  { sku: 'E046304010', name: 'Display LED 347 Square', category: 'Electrical', cost: 2010.25, requestedQty: 3 },
  { sku: 'E066803010', name: 'Rearview mirror', category: 'Body & Panels', cost: 362.76, requestedQty: 20 },
  { sku: '21000-QBB5-A000', name: 'Drive sprocket (45-tooth)', category: 'Drive & Suspension', cost: 1342.05, requestedQty: 5 },
  { sku: '21200-EK3-E00', name: 'Front 17-tooth sprocket', category: 'Drive & Suspension', cost: 2132.95, requestedQty: 4 },
  { sku: 'EG01524010', name: 'Front small sprocket', category: 'Drive & Suspension', cost: 301, requestedQty: 15 },
  { sku: 'E066525010', name: 'Rear big sprocket', category: 'Drive & Suspension', cost: 1339.89, requestedQty: 5 },
  { sku: 'E046525010', name: 'Rear big sprocket', category: 'Drive & Suspension', cost: 1425.45, requestedQty: 8 },
  { sku: 'E056525010', name: 'Rear big sprocket, CG version', category: 'Drive & Suspension', cost: 1380.12, requestedQty: 10 },
  { sku: '21143-EK1-E00', name: 'Sprocket bolts', category: 'Drive & Suspension', cost: 359.88, requestedQty: 4 },
  { sku: 'E066526010', name: 'Sprocket buffer', category: 'Drive & Suspension', cost: 600.2, requestedQty: 2 },
  { sku: 'E056402010', name: 'Front left turn signal, CG version', category: 'Lighting', cost: 399.69, requestedQty: 5 },
  { sku: 'E056403020', name: 'Front right turn signal, CG version', category: 'Lighting', cost: 399.69, requestedQty: 5 },
  { sku: 'E056404030', name: 'Rear left turn signal, CG version', category: 'Lighting', cost: 399.69, requestedQty: 3 },
  { sku: 'E056536010', name: 'E56 front brake shoe (drum brake)', category: 'Brakes', cost: 333.05, requestedQty: 6 },
  { sku: '25306-QBE3-A000', name: 'Rear brake lever', category: 'Brakes', cost: 315.99, requestedQty: 3 },
] as const

const CATEGORY_COLORS: Record<string, string> = {
  Electrical: '#f59e0b',
  'Controls & Handlebar': '#0d9488',
  Lighting: '#eab308',
  'Body & Panels': '#3b82f6',
  'Drive & Suspension': '#8b5cf6',
  Brakes: '#ef4444',
}

/** Adds quote parts to the local catalog once by SKU; never changes existing products or stock. */
export async function importQuotationProducts(): Promise<number> {
  return db.transaction('rw', [db.categories, db.suppliers, db.products], async () => {
    const categories = await db.categories.toArray()
    const categoryIds = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id!]))
    const supplier = (await db.suppliers.toArray()).find((item) => item.name.trim().toLowerCase() === SUPPLIER_NAME.toLowerCase())
    const supplierId = supplier?.id ?? (await db.suppliers.add({
      name: SUPPLIER_NAME,
      notes: `Source quotation ${QUOTE_REFERENCE}. Availability was pending review when quoted.`,
    }))
    const now = Date.now()
    let added = 0

    for (const item of QUOTED_PARTS) {
      const existing = await db.products.where('sku').equals(item.sku).first()
      if (existing) continue

      const categoryKey = item.category.toLowerCase()
      let categoryId = categoryIds.get(categoryKey)
      if (categoryId === undefined) {
        categoryId = (await db.categories.add({ name: item.category, color: CATEGORY_COLORS[item.category] ?? '#64748b' })) as number
        categoryIds.set(categoryKey, categoryId)
      }

      const product: Product = {
        sku: item.sku,
        partNumber: item.sku,
        name: item.name,
        categoryId,
        fitment: [],
        supplierId,
        cost: Math.round(item.cost * 100),
        price: 0,
        stock: 0,
        reorderLevel: 0,
        taxable: true,
        serialized: false,
        trackStock: true,
        active: false,
        createdAt: now,
        updatedAt: now,
      }
      await db.products.add(product)
      added++
    }

    return added
  })
}

export const quotationImportSummary = {
  reference: QUOTE_REFERENCE,
  requestedUnits: QUOTED_PARTS.reduce((sum, item) => sum + item.requestedQty, 0),
  productCount: QUOTED_PARTS.length,
}

export const quotationProductSkus = new Set<string>(QUOTED_PARTS.map((item) => item.sku))
