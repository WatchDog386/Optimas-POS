import Dexie, { type EntityTable } from 'dexie'
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
  kv!: EntityTable<KV, 'key'>

  constructor(name = 'optimas-pos') {
    super(name)
    this.version(1).stores({
      users: '++id, pin, role',
      categories: '++id, name',
      suppliers: '++id, name',
      products: '++id, &sku, barcode, name, categoryId, partNumber, *fitment, supplierId, active',
      customers: '++id, name, phone, plate',
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
  }
}

export const db = new PosDB()
