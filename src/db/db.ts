import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { hashPin, weakPinReason } from '../lib/pinHash'
import type {
  Category,
  Customer,
  LogEntry,
  ParkedSale,
  Product,
  PurchaseOrder,
  Sale,
  ServiceJob,
  Shift,
  StockMovement,
  StockUnit,
  Supplier,
  User,
} from './types'

export interface KV {
  key: string
  value: unknown
}

export class PosDB extends Dexie {
  users!: EntityTable<User, 'id'>
  categories!: EntityTable<Category, 'id'>
  suppliers!: EntityTable<Supplier, 'id'>
  products!: EntityTable<Product, 'id'>
  customers!: EntityTable<Customer, 'id'>
  sales!: EntityTable<Sale, 'id'>
  parked!: EntityTable<ParkedSale, 'id'>
  movements!: EntityTable<StockMovement, 'id'>
  purchaseOrders!: EntityTable<PurchaseOrder, 'id'>
  shifts!: EntityTable<Shift, 'id'>
  jobs!: EntityTable<ServiceJob, 'id'>
  logs!: EntityTable<LogEntry, 'id'>
  units!: EntityTable<StockUnit, 'id'>
  kv!: EntityTable<KV, 'key'>

  constructor(name = 'optimas-pos') {
    super(name)
    this.version(1).stores({
      users: '++id, pin, role',
      categories: '++id, name',
      suppliers: '++id, name',
      products: '++id, &sku, barcode, name, categoryId, partNumber, *fitment, supplierId, active',
      customers: '++id, name, phone, plate, balance',
      sales: '++id, &receiptNo, createdAt, customerId, userId, shiftId, status',
      parked: '++id, createdAt',
      movements: '++id, productId, at, reason',
      purchaseOrders: '++id, &poNo, supplierId, status, createdAt',
      shifts: '++id, userId, openedAt, closedAt',
      jobs: '++id, &jobNo, customerId, status, createdAt',
      kv: 'key',
    })
    this.version(2).stores({
      logs: '++id, at, kind, userId',
    })
    // v3 — production release: hashed PINs, per-unit serial barcodes, and a
    // one-time wipe of the demo/test data earlier builds put on every till.
    this.version(3)
      .stores({
        users: '++id, role',
        units: '++id, &serial, productId, status, saleId',
      })
      .upgrade(productionReset)
  }
}

/** Tables holding demo/test business data in pre-production builds. */
export const BUSINESS_TABLES = [
  'products',
  'categories',
  'suppliers',
  'customers',
  'sales',
  'parked',
  'movements',
  'purchaseOrders',
  'shifts',
  'jobs',
  'logs',
] as const

export const PRE_PRODUCTION_ARCHIVE = 'archive:pre-production'

/** The two accounts every earlier build created with publicly documented PINs. */
const DEFAULT_ACCOUNTS: Record<string, string> = { owner: '1234', cashier: '0000' }

async function productionReset(tx: Transaction): Promise<void> {
  // Keep a copy of everything we remove so nothing is lost for good: the owner
  // can download it from Settings → Backup.
  const archive: Record<string, unknown[]> = {}
  for (const name of BUSINESS_TABLES) {
    archive[name] = await tx.table(name).toArray()
    await tx.table(name).clear()
  }
  const kv = tx.table('kv')
  const seqKeys = (await kv.toCollection().primaryKeys()).filter((k) => String(k).startsWith('seq:'))
  await kv.bulkDelete(seqKeys)
  await kv.put({ key: PRE_PRODUCTION_ARCHIVE, value: { at: Date.now(), data: archive } })

  // Hash every PIN; drop the default demo accounts that still use their public PIN.
  const users = tx.table('users')
  for (const u of (await users.toArray()) as (User & { pin?: string })[]) {
    const pin = u.pin ?? ''
    if (DEFAULT_ACCOUNTS[u.name.trim().toLowerCase()] === pin) {
      await users.delete(u.id!)
      continue
    }
    const { pin: _legacy, ...rest } = u
    void _legacy
    await users.put({ ...rest, pinHash: hashPin(pin), mustChangePin: weakPinReason(pin) !== null || undefined })
  }
}

export const db = new PosDB()
