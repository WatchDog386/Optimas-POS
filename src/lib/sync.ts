// Keeps this till and the shop server in step.
//
//  push  every local change (queued in the outbox by the db middleware,
//        deletes included) goes to the server, oldest first;
//  pull  changes made on other tills come back and are applied locally.
//
// Runs every 15 seconds while signed in, a moment after any local change, and
// when the connection returns. Stock levels are rebuilt from stock movements
// after every pull, so two tills selling the same part never overwrite each
// other's counts.

import { useSyncExternalStore } from 'react'
import { liveQuery, type Subscription } from 'dexie'
import { applyingRemote, db, outboxId, SYNC_TABLES, SYNCED_KV_KEYS, type OutboxEntry } from '../db/db'
import { currentTill, setCurrentTill } from '../db/till'
import type { Product, StockMovement } from '../db/types'
import { api, ApiError, hasServerSession } from './api'
import { trashProducts } from '../db/recovery'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'signed-out' | 'error'

export interface SyncStatus {
  state: SyncState
  /** Local changes not yet on the server. */
  pending: number
  lastSync?: number
  error?: string
}

interface WireChange {
  t: string
  k: unknown
  d: unknown
}

interface PulledChange extends WireChange {
  rev: number
}

const SYNCED = new Set<string>(SYNC_TABLES)
const PUSH_BATCH = 200
/** Keep each push request well under the server's 25 MB limit (photos are data URLs). */
const PUSH_BYTES = 8 * 1024 * 1024

// ------------------------------------------------------------- status store

let status: SyncStatus = { state: 'signed-out', pending: 0 }
const listeners = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  for (const l of listeners) l()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status,
  )
}

// ------------------------------------------------------------- till number

/** Make sure the server knows this till and its number is unique in the shop. */
export async function registerTill(): Promise<number> {
  const known = (await db.kv.get('till:registered'))?.value === true
  const r = await api<{ till: number }>('/sync/till', { method: 'POST', json: { till: currentTill(), known } })
  if (r.till !== currentTill()) setCurrentTill(r.till)
  await db.kv.bulkPut([
    { key: 'till:number', value: r.till },
    { key: 'till:registered', value: true },
  ])
  return r.till
}

// ------------------------------------------------------------- push

async function readRecord(table: string, key: unknown): Promise<unknown> {
  const value = await db.table(table).get(key as never)
  return value ?? null
}

/** Send queued local changes. Returns how many were sent. */
export async function pushChanges(): Promise<number> {
  let sent = 0
  for (;;) {
    const entries = await db.outbox.orderBy('at').limit(PUSH_BATCH).toArray()
    if (entries.length === 0) return sent
    const batch: OutboxEntry[] = []
    const changes: WireChange[] = []
    let bytes = 0
    for (const e of entries) {
      const d = await readRecord(e.table, e.key)
      const size = d ? JSON.stringify(d).length : 16
      if (batch.length > 0 && bytes + size > PUSH_BYTES) break
      bytes += size
      batch.push(e)
      changes.push({ t: e.table, k: e.key, d })
    }
    const r = await api<{ stored: number; ignored: number; rejected: { index: number; error: string }[] }>('/sync/push', {
      method: 'POST',
      json: { till: currentTill(), changes },
    })
    if (r.rejected.length) console.warn('Server rejected some changes', r.rejected)
    // Clear only entries that were not changed again while the request was in flight.
    await db.transaction('rw', db.outbox, async () => {
      for (const e of batch) {
        const now = await db.outbox.get(e.id)
        if (now && now.at === e.at) await db.outbox.delete(e.id)
      }
    })
    sent += batch.length
    if (entries.length < PUSH_BATCH && batch.length === entries.length) return sent
  }
}

// ------------------------------------------------------------- pull

/**
 * Apply changes from the server. Local changes still waiting to be pushed win
 * (they reach the server next and replace the remote version there too).
 */
export async function applyChanges(changes: PulledChange[] | WireChange[], last?: number): Promise<void> {
  await applyingRemote([...SYNC_TABLES], async () => {
    const pending = new Set((await db.outbox.toCollection().primaryKeys()) as string[])
    const touched = new Set<number>()
    // Parts deleted on another till: keep a copy (with labels and stock history)
    // in this till's recycle bin before anything in this batch removes them.
    const removed = changes
      .filter((c) => c.t === 'products' && (c.d === null || c.d === undefined) && !pending.has(outboxId(c.t, c.k)))
      .map((c) => c.k as number)
    if (removed.length) await trashProducts(removed, 'another till')
    for (const c of changes) {
      if (!SYNCED.has(c.t)) continue
      if (c.t === 'kv' && !SYNCED_KV_KEYS.has(String(c.k))) continue
      if (pending.has(outboxId(c.t, c.k))) continue
      const table = db.table(c.t)
      if (c.d === null || c.d === undefined) {
        if (c.t === 'movements') {
          const m = (await table.get(c.k as never)) as StockMovement | undefined
          if (m) touched.add(m.productId)
        }
        await table.delete(c.k as never)
        continue
      }
      let data = c.d as Record<string, unknown>
      if (c.t === 'products') {
        // Stock is this till's own count, rebuilt from movements below.
        const local = (await table.get(c.k as never)) as Product | undefined
        data = { ...data, stock: local?.stock ?? 0 }
        touched.add(c.k as number)
      }
      if (c.t === 'movements') touched.add((data as unknown as StockMovement).productId)
      try {
        await table.put(data)
      } catch (e) {
        if (c.t !== 'products' || !(e instanceof Error) || e.name !== 'ConstraintError') throw e
        await resolveSkuClash(data as unknown as Product)
        await table.put(data)
      }
    }
    for (const id of touched) await rebuildStock(id)
    if (last !== undefined) await db.syncstate.put({ key: 'pull:rev', value: last })
  })
}

/** Two tills created the same SKU offline: the server's part keeps it, ours is renamed (and pushed). */
async function resolveSkuClash(incoming: Product) {
  const clash = await db.products.where('sku').equals(incoming.sku).first()
  if (!clash || clash.id === incoming.id) return
  const sku = `${clash.sku}-T${String(currentTill()).padStart(2, '0')}`
  await db.products.update(clash.id!, { sku, updatedAt: Date.now() })
  await db.outbox.put({ id: outboxId('products', clash.id), table: 'products', key: clash.id, at: Date.now() })
}

/** Stock on hand = the sum of the part's stock movements (sales, receipts, counts…). */
export async function rebuildStock(productId: number): Promise<void> {
  const product = await db.products.get(productId)
  if (!product || !product.trackStock) return
  let stock = 0
  await db.movements.where('productId').equals(productId).each((m) => {
    stock += m.change
  })
  if (stock !== product.stock) await db.products.update(productId, { stock })
}

/** Fetch and apply everything newer than what this till last saw. */
export async function pullChanges(): Promise<number> {
  let since = ((await db.syncstate.get('pull:rev'))?.value as number | undefined) ?? 0
  let applied = 0
  for (;;) {
    const r = await api<{ changes: PulledChange[]; last: number; more: boolean }>(
      `/sync/pull?since=${since}&till=${currentTill()}`,
    )
    if (r.changes.length || r.last !== since) await applyChanges(r.changes, r.last)
    applied += r.changes.length
    since = r.last
    if (!r.more) return applied
  }
}

// ------------------------------------------------------------- loop

let running: Promise<void> | null = null
let again = false
let registered = false
let timer: number | undefined
let debounce: number | undefined
let outboxSub: Subscription | undefined

/** One full push + pull. Safe to call any time; overlapping calls are merged. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      await syncOnce()
    } while (again)
  })().finally(() => {
    running = null
  })
  return running
}

async function syncOnce() {
  if (!hasServerSession()) return setStatus({ state: 'signed-out' })
  if (!navigator.onLine) return setStatus({ state: 'offline' })
  setStatus({ state: 'syncing', error: undefined })
  try {
    if (!registered) {
      await registerTill()
      registered = true
    }
    await pushChanges()
    await pullChanges()
    setStatus({ state: 'idle', lastSync: Date.now() })
    await db.syncstate.put({ key: 'last-sync', value: Date.now() })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) setStatus({ state: 'signed-out', error: e.message })
    else if (e instanceof TypeError) setStatus({ state: 'offline', error: 'Shop server unreachable' })
    else setStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

const onOnline = () => void syncNow()

/** Start background sync after sign-in. */
export function startSync() {
  stopSync()
  void db.syncstate.get('last-sync').then((r) => r && setStatus({ lastSync: r.value as number }))
  outboxSub = liveQuery(() => db.outbox.count()).subscribe((n) => {
    setStatus({ pending: n })
    if (n > 0) {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void syncNow(), 1500)
    }
  })
  timer = window.setInterval(() => void syncNow(), 15_000)
  window.addEventListener('online', onOnline)
  void syncNow()
}

export function stopSync() {
  window.clearInterval(timer)
  window.clearTimeout(debounce)
  outboxSub?.unsubscribe()
  outboxSub = undefined
  window.removeEventListener('online', onOnline)
  registered = false
  setStatus({ state: 'signed-out' })
}

/** Forget what was pulled and download the server's full copy again. */
export async function redownloadAll(): Promise<void> {
  await db.syncstate.delete('pull:rev')
  await syncNow()
}
