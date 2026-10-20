import { db } from './db'
import type { Product } from './types'
import { sampleImageFor } from './sampleImages'

/** Sample catalogue so the shop can try the system on day one. Safe to delete from Inventory. */
export async function seedIfEmpty(): Promise<void> {
  if ((await db.users.count()) > 0) return

  await db.transaction('rw', [db.users, db.categories, db.suppliers, db.products, db.customers], async () => {
    await db.users.bulkAdd([
      { name: 'Owner', pin: '1234', role: 'owner', active: true },
      { name: 'Cashier', pin: '0000', role: 'cashier', active: true },
    ])

    const cats = [
      ['Brakes', '#ef4444'],
      ['Tyres & Tubes', '#64748b'],
      ['Electrical', '#f59e0b'],
      ['Lighting', '#eab308'],
      ['Body & Panels', '#3b82f6'],
      ['Drive & Suspension', '#8b5cf6'],
      ['Charging', '#10b981'],
      ['Accessories', '#ec4899'],
      ['Labour', '#0ea5e9'],
    ] as const
    const catIds: Record<string, number> = {}
    for (const [name, color] of cats) catIds[name] = (await db.categories.add({ name, color })) as number

    const supA = (await db.suppliers.add({ name: 'Main Parts Distributor', phone: '0700 000 001' })) as number
    const supB = (await db.suppliers.add({ name: 'Tyre & Tube Wholesalers', phone: '0700 000 002' })) as number

    const now = Date.now()
    const E450 = 'Ekon 450'
    const E500 = 'Ekon 500'
    const CMD = 'Commando'
    type Row = [string, string, string, number, number, number, number, string[], number?, string?, boolean?]
    // sku, name, category, cost KES, price KES, stock, reorder, fitment, supplier, barcode, serialized
    const rows: Row[] = [
      ['BRK-PAD-F', 'Front brake pads (disc)', 'Brakes', 450, 850, 24, 8, [E450, E500], supA, '6001000000011'],
      ['BRK-PAD-R', 'Rear brake shoes (drum)', 'Brakes', 380, 700, 18, 8, [E450, E500, CMD], supA, '6001000000028'],
      ['BRK-CBL-F', 'Front brake cable', 'Brakes', 220, 450, 15, 5, [E450, E500, CMD], supA],
      ['BRK-LEV-L', 'Brake lever, left (with cut-off switch)', 'Brakes', 600, 1200, 6, 3, [E450, E500], supA],
      ['BRK-DSC-F', 'Front brake disc rotor', 'Brakes', 1800, 3200, 4, 2, [E450, E500], supA],
      ['TYR-90-90-17', 'Tyre 90/90-17 rear', 'Tyres & Tubes', 2600, 3800, 10, 4, [], supB, '6001000000035'],
      ['TYR-275-17', 'Tyre 2.75-17 front', 'Tyres & Tubes', 2100, 3200, 10, 4, [], supB],
      ['TUB-17', 'Inner tube 17"', 'Tyres & Tubes', 350, 650, 30, 10, [], supB, '6001000000042'],
      ['ELC-THR', 'Throttle grip assembly', 'Electrical', 1400, 2500, 8, 3, [E450, E500, CMD], supA],
      ['ELC-CTRL', 'Motor controller 72V', 'Electrical', 14000, 21000, 2, 1, [E450], supA, undefined, true],
      ['ELC-DCDC', 'DC-DC converter 72V→12V', 'Electrical', 2800, 4500, 5, 2, [E450, E500], supA],
      ['ELC-HRN', 'Horn 12V', 'Electrical', 300, 600, 12, 4, [], supA],
      ['ELC-SW-HB', 'Handlebar switch, right', 'Electrical', 900, 1700, 6, 3, [E450, E500], supA],
      ['ELC-KEY', 'Ignition key switch set', 'Electrical', 1200, 2200, 5, 2, [E450, E500, CMD], supA],
      ['LGT-HEAD', 'LED headlamp unit', 'Lighting', 2400, 4200, 4, 2, [E450, E500], supA],
      ['LGT-TAIL', 'LED tail/brake lamp', 'Lighting', 900, 1600, 7, 3, [E450, E500, CMD], supA],
      ['LGT-IND', 'Indicator (pair)', 'Lighting', 500, 950, 14, 6, [], supA, '6001000000059'],
      ['BDY-MIR', 'Mirror set (pair)', 'Body & Panels', 450, 900, 20, 6, [], supA, '6001000000066'],
      ['BDY-FND-F', 'Front mudguard', 'Body & Panels', 1100, 2000, 5, 2, [E450, E500], supA],
      ['BDY-SEAT', 'Seat assembly', 'Body & Panels', 3500, 5800, 3, 1, [E450], supA],
      ['BDY-SIDE-L', 'Side panel, left', 'Body & Panels', 1600, 2800, 3, 2, [E500], supA],
      ['DRV-SHK-R', 'Rear shock absorber (pair)', 'Drive & Suspension', 4200, 6800, 4, 2, [E450, E500], supA],
      ['DRV-BRG', 'Wheel bearing 6301', 'Drive & Suspension', 180, 400, 40, 10, [], supA, '6001000000073'],
      ['DRV-FORK-S', 'Fork oil seal set', 'Drive & Suspension', 350, 750, 12, 4, [E450, E500, CMD], supA],
      ['CHG-CHG', 'Charger 72V (home)', 'Charging', 6500, 9500, 3, 1, [E450, E500], supA, undefined, true],
      ['CHG-PLUG', 'Charging port socket', 'Charging', 800, 1500, 6, 2, [E450, E500], supA],
      ['ACC-HLM', 'Helmet, full face', 'Accessories', 1800, 3000, 10, 3, [], supA, '6001000000080'],
      ['ACC-REF', 'Reflector jacket', 'Accessories', 350, 700, 25, 8, [], supA, '6001000000097'],
      ['ACC-PHN', 'Phone holder (handlebar)', 'Accessories', 400, 850, 12, 4, [], supA],
      ['ACC-LOCK', 'Disc brake lock', 'Accessories', 700, 1300, 8, 3, [], supA],
      ['LAB-FIT', 'Fitting labour (per part)', 'Labour', 0, 300, 0, 0, [], undefined, undefined],
      ['LAB-DIAG', 'Electrical diagnosis', 'Labour', 0, 500, 0, 0, [], undefined, undefined],
    ]

    const products: Product[] = rows.map(([sku, name, cat, cost, price, stock, reorder, fitment, supplierId, barcode, serialized]) => ({
      sku,
      name,
      barcode,
      image: sampleImageFor(sku, cat),
      categoryId: catIds[cat],
      fitment,
      cost: cost * 100,
      price: price * 100,
      stock: cat === 'Labour' ? 0 : stock,
      reorderLevel: reorder,
      supplierId,
      taxable: true,
      serialized: !!serialized,
      trackStock: cat !== 'Labour',
      active: true,
      createdAt: now,
      updatedAt: now,
    }))
    await db.products.bulkAdd(products)

    await db.customers.bulkAdd([
      { name: 'Walk-in rider (sample)', phone: '0712 345 678', bikeModel: E450, plate: 'KMxx 123A', balance: 0, creditLimit: 0, createdAt: now },
      { name: 'Boda fleet (sample)', phone: '0722 000 111', bikeModel: E500, balance: 0, creditLimit: 5000000, notes: 'Fleet account, pays monthly', createdAt: now },
    ])
  })
}

/** Backfill sample Unsplash photos on products that have none (existing installs). */
export async function backfillSampleImages(): Promise<void> {
  const cats = await db.categories.toArray()
  const catName = new Map(cats.map((c) => [c.id!, c.name]))
  const products = await db.products.toArray()
  const updates = products
    .filter((p) => !p.image)
    .map((p) => ({ key: p.id!, changes: { image: sampleImageFor(p.sku, catName.get(p.categoryId ?? -1)) } }))
    .filter((u) => u.changes.image)
  if (updates.length) await db.products.bulkUpdate(updates)
}
