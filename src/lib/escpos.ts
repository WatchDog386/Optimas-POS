import type { Customer, Product, Sale, Settings } from '../db/types'

// Minimal ESC/POS command builder. Works with the vast majority of 58/80mm thermal
// printers (Epson TM series, Xprinter, Rongta, HPRT, Sunmi built-ins, etc.).

const ESC = 0x1b
const GS = 0x1d

export class EscPos {
  private bytes: number[] = []
  constructor(public readonly width: number) {}

  init() {
    this.bytes.push(ESC, 0x40)
    return this
  }
  align(a: 'left' | 'center' | 'right') {
    this.bytes.push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2)
    return this
  }
  bold(on: boolean) {
    this.bytes.push(ESC, 0x45, on ? 1 : 0)
    return this
  }
  size(double: boolean) {
    this.bytes.push(GS, 0x21, double ? 0x11 : 0x00)
    return this
  }
  text(s: string) {
    // Thermal printers default to code page 437; strip anything outside printable ASCII.
    for (const ch of s.normalize('NFKD')) {
      const c = ch.charCodeAt(0)
      if (c === 10 || (c >= 32 && c < 127)) this.bytes.push(c)
    }
    return this
  }
  line(s = '') {
    return this.text(s + '\n')
  }
  rule(ch = '-') {
    return this.line(ch.repeat(this.width))
  }
  /** Left and right text on one line, padded to the paper width. */
  pair(left: string, right: string) {
    const space = this.width - right.length
    const l = left.length > space - 1 ? left.slice(0, space - 1) : left
    return this.line(l + ' '.repeat(Math.max(1, space - l.length)) + right)
  }
  feed(n = 1) {
    this.bytes.push(ESC, 0x64, n)
    return this
  }
  cut() {
    this.bytes.push(GS, 0x56, 0x42, 0x00)
    return this
  }
  /** Pulse pin 2 to pop a cash drawer wired to the printer's RJ11 DK port. */
  kickDrawer() {
    this.bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa)
    return this
  }
  /** Print a CODE128 barcode (alphanumeric, works with most thermal/label printers). */
  barcode(code: string, opts: { height?: number } = {}) {
    const h = Math.min(Math.max(opts.height ?? 40, 1), 255)
    this.bytes.push(GS, 0x68, h) // GS h barcode height
    this.bytes.push(GS, 0x6b, 73) // GS k 73 = CODE128
    for (const ch of code) this.bytes.push(ch.charCodeAt(0))
    this.bytes.push(0) // NUL terminator
    return this
  }
  build(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

export function columnsFor(paperWidth: 58 | 80): number {
  return paperWidth === 58 ? 32 : 48
}

const amt = (cents: number) =>
  (cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', account: 'On account' }

export function receiptBytes(
  sale: Sale,
  settings: Settings,
  opts: { cashier?: string; customer?: Customer; kickDrawer?: boolean; copy?: boolean } = {},
): Uint8Array {
  const p = new EscPos(columnsFor(settings.paperWidth)).init()
  if (opts.kickDrawer) p.kickDrawer()
  p.align('center').bold(true).size(true).line(settings.shopName).size(false).bold(false)
  if (settings.address) p.line(settings.address)
  if (settings.phone) p.line(`Tel: ${settings.phone}`)
  if (settings.kraPin) p.line(`KRA PIN: ${settings.kraPin}`)
  if (opts.copy) p.bold(true).line('*** REPRINT ***').bold(false)
  if (sale.refundOf) p.bold(true).line('REFUND').bold(false)
  p.align('left').rule()
  p.pair(`Receipt: ${sale.receiptNo}`, '')
  p.line(new Date(sale.createdAt).toLocaleString('en-KE'))
  if (opts.cashier) p.line(`Served by: ${opts.cashier}`)
  if (opts.customer) p.line(`Customer: ${opts.customer.name}`)
  p.rule()
  for (const l of sale.lines) {
    p.line(l.name)
    const gross = l.qty * l.unitPrice - l.discount
    p.pair(`  ${l.qty} x ${amt(l.unitPrice)}${l.discount ? ` -${amt(l.discount)}` : ''}`, amt(gross))
    if (l.sku) p.line(`  ${l.sku}${l.serial ? `  S/N ${l.serial}` : ''}`)
  }
  p.rule()
  p.pair('Subtotal', amt(sale.subtotal))
  if (sale.discount) p.pair('Discount', `-${amt(sale.discount)}`)
  p.pair(settings.pricesIncludeVat ? `VAT ${settings.vatRate}% (incl.)` : `VAT ${settings.vatRate}%`, amt(sale.tax))
  p.bold(true).size(true).pair('TOTAL', amt(sale.total)).size(false).bold(false)
  p.rule()
  for (const pay of sale.payments) {
    p.pair(`${METHOD_LABEL[pay.method]}${pay.reference ? ` ${pay.reference}` : ''}`, amt(pay.amount))
  }
  if (sale.change) p.pair('Change', amt(sale.change))
  if (settings.mpesaTill) p.line(`M-Pesa Till: ${settings.mpesaTill}`)
  p.rule().align('center')
  if (settings.receiptFooter) p.line(settings.receiptFooter)
  p.bold(true).line('Thank you for your business!').bold(false)
  p.feed(3).cut()
  return p.build()
}

export function barcodeLabelBytes(product: Product, settings: Settings): Uint8Array {
  const cols = columnsFor(settings.paperWidth)
  const p = new EscPos(cols).init()
  p.align('center')
  p.bold(true).size(true).line(product.name.slice(0, cols)).size(false).bold(false)
  p.line(product.sku)
  p.barcode(product.barcode || product.sku, { height: 50 })
  p.feed(2).cut()
  return p.build()
}

export function drawerKickBytes(): Uint8Array {
  return new EscPos(48).init().kickDrawer().build()
}

export function testPageBytes(settings: Settings): Uint8Array {
  const p = new EscPos(columnsFor(settings.paperWidth)).init()
  p.align('center').bold(true).size(true).line('PRINTER OK').size(false).bold(false)
  p.line(settings.shopName).line(new Date().toLocaleString('en-KE')).align('left').rule()
  p.pair('Left', 'Right').line('0123456789'.repeat(5).slice(0, columnsFor(settings.paperWidth)))
  return p.feed(3).cut().build()
}
