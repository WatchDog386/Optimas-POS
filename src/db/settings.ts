import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  shopName: 'Optimas Moto Spares',
  address: 'Nairobi, Kenya',
  phone: '',
  kraPin: '',
  vatRate: 16,
  pricesIncludeVat: true,
  receiptFooter: 'Goods once sold are not returnable without a receipt. Thank you!',
  currency: 'KES',
  mpesaTill: '',
  mpesaMode: 'manual',
  apiUrl: '/api',
  bikeModels: ['Ekon 450', 'Ekon 500', 'Commando', 'Universal / other e-bike'],
  paperWidth: 80,
  autoPrint: false,
  openDrawerOnCash: true,
}

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings')
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await db.kv.put({ key: 'settings', value: { ...current, ...patch } })
}

export function useSettings(): Settings {
  return useLiveQuery(getSettings, [], DEFAULT_SETTINGS)
}

/** Sequential, human-friendly document numbers stored in the kv table. */
export async function nextNumber(prefix: string): Promise<string> {
  return db.transaction('rw', db.kv, async () => {
    const key = `seq:${prefix}`
    const row = await db.kv.get(key)
    const next = ((row?.value as number) ?? 0) + 1
    await db.kv.put({ key, value: next })
    return `${prefix}-${String(next).padStart(6, '0')}`
  })
}
