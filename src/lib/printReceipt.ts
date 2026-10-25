import { db } from '../db/db'
import type { Product, Sale, Settings, StockUnit } from '../db/types'
import { drawerKickBytes, escposLabelBytes, receiptBytes } from './escpos'
import { loadBarcodePrinterConfig, loadPrinterConfig, sendRaw } from './printer'
import { printLabelsInBrowser, tsplBytes, type LabelJob } from './labels'

/**
 * Print a receipt on the configured printer. Returns false when no raw printer is set up,
 * in which case the caller should fall back to window.print().
 */
export async function printReceipt(sale: Sale, settings: Settings, opts: { copy?: boolean } = {}): Promise<boolean> {
  const cfg = loadPrinterConfig()
  if (cfg.mode === 'browser') return false
  const [user, customer] = await Promise.all([
    db.users.get(sale.userId),
    sale.customerId ? db.customers.get(sale.customerId) : undefined,
  ])
  const paidCash = sale.payments.some((p) => p.method === 'cash')
  const bytes = receiptBytes(sale, settings, {
    cashier: user?.name,
    customer,
    copy: opts.copy,
    kickDrawer: !opts.copy && paidCash && settings.openDrawerOnCash,
  })
  await sendRaw(bytes, cfg, settings.apiUrl)
  return true
}

/** Label jobs for a product: one per unit serial, or `copies` of the product barcode. */
export function labelJobs(product: Product, units?: StockUnit[], copies = 1): LabelJob[] {
  const base = { name: product.name, sku: product.sku, price: product.price }
  if (units && units.length) return units.map((u) => ({ ...base, code: u.serial }))
  const code = product.barcode || product.sku
  return Array.from({ length: Math.max(1, copies) }, () => ({ ...base, code }))
}

export type LabelOutcome = 'printed' | 'browser' | 'blocked'

/**
 * Print barcode labels on the label printer configured in Settings → Hardware
 * (TSPL for Xprinter label models, ESC/POS for receipt-type printers), or in
 * the browser print dialog when no label printer is set up.
 */
export async function printLabels(jobs: LabelJob[], settings: Settings): Promise<LabelOutcome> {
  if (jobs.length === 0) return 'printed'
  const cfg = loadBarcodePrinterConfig()
  if (cfg.mode === 'browser') return printLabelsInBrowser(jobs, settings) ? 'browser' : 'blocked'
  const bytes = settings.labelLanguage === 'escpos' ? escposLabelBytes(jobs, settings) : tsplBytes(jobs, settings)
  await sendRaw(bytes, cfg, settings.apiUrl, 'label')
  return 'printed'
}

export async function openDrawer(settings: Settings): Promise<void> {
  await sendRaw(drawerKickBytes(), loadPrinterConfig(), settings.apiUrl)
}
