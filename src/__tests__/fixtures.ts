import { db } from '../db/db'
import type { Product, SaleLine } from '../db/types'

export const lineFor = (p: Product, qty = 1, serial?: string): SaleLine => ({
  productId: p.id,
  name: p.name,
  sku: p.sku,
  qty,
  unitPrice: p.price,
  unitCost: p.cost,
  discount: 0,
  taxable: p.taxable,
  ...(serial ? { serial } : {}),
})

function part(sku: string, name: string, price: number, cost: number, stock: number, extra: Partial<Product> = {}): Product {
  return {
    sku,
    name,
    price,
    cost,
    stock,
    fitment: [],
    reorderLevel: 2,
    taxable: true,
    serialized: false,
    trackStock: true,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  }
}

/** A small, clearly-fake catalogue used only by tests. */
export async function seedTestData() {
  // Staff: a fresh database already holds Optimas Admin (1, PIN 0735) and Cashier (2, PIN 2323).
  await db.products.bulkAdd([
    part('BRK-PAD-F', 'Front brake pads', 850_00, 500_00, 10),
    part('TUB-17', 'Inner tube 17"', 650_00, 400_00, 8),
    part('ACC-HLM', 'Helmet', 3_000_00, 2_000_00, 4),
    part('ELC-CTRL', 'Controller 48V', 21_000_00, 15_000_00, 5, { serialized: true }),
    part('BRK-LEV-L', 'Brake lever (left)', 450_00, 250_00, 6, { reorderLevel: 3 }),
    part('LAB-FIT', 'Fitting labour', 300_00, 0, 0, { trackStock: false, taxable: false }),
  ])
  await db.customers.add({ name: 'Boda Fleet Ltd', balance: 0, creditLimit: 50_000_00, createdAt: Date.now() })
}

export const bySku = async (sku: string) => (await db.products.where('sku').equals(sku).first())!
