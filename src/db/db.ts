import Dexie, { type DBCore, type DBCoreMutateRequest, type DBCoreTable, type DBCoreTransaction, type EntityTable, type Middleware, type Transaction } from 'dexie'
import { hashPin, weakPinReason } from '../lib/pinHash'
import { MAX_TILL, newId, randomTill, setCurrentTill } from './till'
import { DEFAULT_STAFF } from './defaultStaff'
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

/** A local change waiting to be sent to the shop server. One row per record. */
export interface OutboxEntry {
  id: string
  table: string
  key: unknown
  at: number
}

/** Tables copied to the shop server. Staff accounts sync through the auth API instead. */
export const SYNC_TABLES = [
  'categories',
  'suppliers',
  'products',
  'customers',
  'sales',
  'parked',
  'movements',
  'purchaseOrders',
  'shifts',
  'jobs',
  'logs',
  'units',
  'kv',
] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/** Of the key/value table only the shop settings are shared; counters, locks and UI state stay on the till. */
export const SYNCED_KV_KEYS = new Set(['settings'])

const SYNCED = new Set<string>(SYNC_TABLES)

export const outboxId = (table: string, key: unknown) => `${table}|${JSON.stringify(key)}`

/** Transactions that apply changes received from the server: not recorded in the outbox. */
const remoteTransactions = new WeakSet<object>()

/**
 * Records every create, update and delete on a synced table in the outbox, in
 * the same transaction as the change itself — so nothing is ever missed, deletes
 * included (a deleted part must not come back from the server).
 */
const syncMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'outbox',
  create(down) {
    return {
      ...down,
      transaction(stores, mode, options) {
        const remote = stores.includes('syncstate')
        const touchesSynced = mode === 'readwrite' && stores.some((s) => SYNCED.has(s))
        const list = touchesSynced && !stores.includes('outbox') && down.schema.tables.some((t) => t.name === 'outbox') ? [...stores, 'outbox'] : stores
        const trans = down.transaction(list, mode, options)
        if (remote) remoteTransactions.add(trans)
        return trans
      },
      table(name) {
        const table = down.table(name)
        if (!SYNCED.has(name)) return table
        return {
          ...table,
          async mutate(req: DBCoreMutateRequest) {
            const trans = req.trans as DBCoreTransaction & { mode?: string }
            if (remoteTransactions.has(trans) || trans.mode === 'versionchange') return table.mutate(req)
            let keys: unknown[] = []
            if (req.type === 'deleteRange') {
              const found = await table.query({ trans, values: false, query: { index: table.schema.primaryKey, range: req.range } })
              keys = found.result
            } else if (req.type === 'delete') keys = req.keys
            const res = await table.mutate(req)
            if (req.type === 'add') keys = res.results ?? req.keys ?? []
            else if (req.type === 'put') keys = res.results ?? req.keys ?? req.updates?.keys ?? []
            if (name === 'kv') keys = keys.filter((k) => SYNCED_KV_KEYS.has(String(k)))
            if (keys.length) await recordOutbox(down.table('outbox'), trans, name, keys)
            return res
          },
        } satisfies DBCoreTable
      },
    }
  },
}

async function recordOutbox(outbox: DBCoreTable, trans: DBCoreTransaction, table: string, keys: unknown[]) {
  const at = Date.now()
  await outbox.mutate({ type: 'put', trans, values: keys.map((key) => ({ id: outboxId(table, key), table, key, at })) })
}

/** Put every synced record on this till in the outbox (first sync, or after a restore). */
export async function queueAllForUpload(tx?: Transaction): Promise<number> {
  const run = async (t: (name: string) => Dexie.Table) => {
    const at = Date.now()
    let n = 0
    for (const name of SYNC_TABLES) {
      let keys = (await t(name).toCollection().primaryKeys()) as unknown[]
      if (name === 'kv') keys = keys.filter((k) => SYNCED_KV_KEYS.has(String(k)))
      await t('outbox').bulkPut(keys.map((key) => ({ id: outboxId(name, key), table: name, key, at })))
      n += keys.length
    }
    return n
  }
  if (tx) return run((name) => tx.table(name))
  return db.transaction('rw', [...SYNC_TABLES, 'outbox', 'syncstate'], () => run((name) => db.table(name)))
}

/** Run `fn` in a transaction whose writes are NOT queued for upload (server → till changes). */
export function applyingRemote<T>(tables: string[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...tables, 'syncstate', 'outbox'], fn)
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
  outbox!: EntityTable<OutboxEntry, 'id'>
  syncstate!: EntityTable<KV, 'key'>

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
    // v4 — server sync: outbox of local changes and sync bookkeeping.
    this.version(4)
      .stores({
        outbox: 'id, at',
        syncstate: 'key',
      })
      .upgrade(async (tx) => {
        // Stock is rebuilt from movements when syncing, so give any part whose
        // count isn't fully explained by its movements a baseline movement.
        const totals = new Map<number, number>()
        await tx.table('movements').each((m: StockMovement) => totals.set(m.productId, (totals.get(m.productId) ?? 0) + m.change))
        for (const p of (await tx.table('products').toArray()) as Product[]) {
          const diff = p.trackStock ? p.stock - (totals.get(p.id!) ?? 0) : 0
          if (diff !== 0) await tx.table('movements').add({ id: newId(), productId: p.id, change: diff, reason: 'count', note: 'Stock baseline (sync)', at: Date.now() })
        }
        // Everything already on this till goes to the server on the first sync.
        await queueAllForUpload(tx)
      })

    // v5 — the shop runs exactly two accounts: Optimas Admin and Cashier.
    this.version(5)
      .stores({})
      .upgrade((tx) => installDefaultStaff(tx))
    // A brand-new till starts with the same two accounts.
    this.on('populate', (tx) => installDefaultStaff(tx))

    this.use(syncMiddleware)
    // New records get IDs that are unique across every till in the shop.
    for (const name of [...SYNC_TABLES.filter((t) => t !== 'kv'), 'users']) {
      this.table(name).hook('creating', (primKey) => (primKey === undefined ? newId() : undefined))
    }
    // Load (or pick) this till's number before anything else touches the database.
    this.on('ready', async (vipDb) => {
      const kv = (vipDb as Dexie).table('kv')
      const row = await kv.get('till:number')
      let n = typeof row?.value === 'number' && row.value >= 1 && row.value <= MAX_TILL ? row.value : 0
      if (!n) {
        n = randomTill()
        await kv.put({ key: 'till:number', value: n })
      }
      setCurrentTill(n)
    })
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

async function installDefaultStaff(tx: Transaction): Promise<void> {
  const users = tx.table('users')
  await users.clear()
  await users.bulkAdd(DEFAULT_STAFF.map((u) => ({ id: u.id, name: u.name, role: u.role, active: true, pinHash: hashPin(u.pin) })))
}

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
