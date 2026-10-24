import { db } from '../db/db'
import type { Product, Sale, Settings } from '../db/types'
import { barcodeLabelBytes, drawerKickBytes, receiptBytes } from './escpos'
import { loadBarcodePrinterConfig, loadPrinterConfig, sendRaw } from './printer'

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

/**
 * Print a barcode label for a product on the configured printer. Returns false when no raw
 * printer is set up (browser mode), in which case the caller should fall back to window.print().
 * @param copies number of duplicate labels to print (default 1)
 */
export async function printBarcodeLabel(product: Product, settings: Settings, copies: number = 1): Promise<boolean> {
  let cfg = loadBarcodePrinterConfig()
  // Fall back to the receipt printer when no dedicated barcode printer is configured.
  if (cfg.mode === 'browser') {
    const receiptCfg = loadPrinterConfig()
    if (receiptCfg.mode !== 'browser') cfg = receiptCfg
    else return false
  }
  const bytes = barcodeLabelBytes(product, settings)
  for (let i = 1; i < copies; i++) {
    await sendRaw(bytes, cfg, settings.apiUrl)
  }
  await sendRaw(bytes, cfg, settings.apiUrl)
  return true
}

export async function openDrawer(settings: Settings): Promise<void> {
  await sendRaw(drawerKickBytes(), loadPrinterConfig(), settings.apiUrl)
}
