// Barcode labels. One label per physical unit: the product name/price/SKU are
// the same on every copy, the barcode is the unit's own serial.
//
// Output formats:
//  - TSPL    Xprinter label printers (XP-235B, XP-365B, XP-420B, XP-460B, XP-470B…),
//            TSC, Gprinter and most 203-dpi desktop label printers.
//  - ESC/POS Receipt-type printers (Xprinter XP-58/XP-80, Epson TM…) printing on a roll.
//  - Browser The system print dialog with real scannable Code 128 SVG barcodes.

import type { Settings } from '../db/types'
import { code128Svg, code128Widths } from './barcode'

export interface LabelJob {
  name: string
  sku: string
  /** Barcode content — a unit serial or the product barcode. */
  code: string
  price?: number
}

type LabelSettings = Pick<
  Settings,
  'shopName' | 'currency' | 'labelWidthMm' | 'labelHeightMm' | 'labelGapMm' | 'labelDensity' | 'labelShowPrice' | 'labelShowShopName' | 'paperWidth'
>

const DOTS_PER_MM = 8 // 203 dpi

/** Printers only take plain ASCII; quotes would end a TSPL string. */
export function labelText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, "'")
    .trim()
}

export const priceText = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

/** Split text into at most two lines of `max` characters, breaking at spaces. */
export function wrap(s: string, max: number): [string, string?] {
  if (s.length <= max) return [s]
  let cut = s.lastIndexOf(' ', max)
  if (cut < max / 2) cut = max
  const first = s.slice(0, cut).trimEnd()
  const rest = s.slice(cut).trim()
  return [first, rest ? fit(rest, max) : undefined]
}

function fit(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '.'
}

// TSPL bitmap fonts: [width, height] in dots at 1x.
const FONT: Record<'1' | '2' | '3', [number, number]> = { '1': [8, 12], '2': [12, 20], '3': [16, 24] }

/** TSPL commands for a batch of labels (one CLS…PRINT block per label). */
export function tsplLabels(jobs: LabelJob[], s: LabelSettings): string {
  const w = Math.round(s.labelWidthMm * DOTS_PER_MM)
  const h = Math.round(s.labelHeightMm * DOTS_PER_MM)
  const margin = 12
  const header = [
    `SIZE ${s.labelWidthMm} mm,${s.labelHeightMm} mm`,
    `GAP ${s.labelGapMm} mm,0 mm`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'OFFSET 0 mm',
    'SET TEAR ON',
    `DENSITY ${Math.min(15, Math.max(0, Math.round(s.labelDensity)))}`,
    'SPEED 4',
    'CODEPAGE 1252',
  ]
  const centerX = (chars: number, font: keyof typeof FONT) => Math.max(margin, Math.round((w - chars * FONT[font][0]) / 2))
  const text = (y: number, font: keyof typeof FONT, value: string) => {
    const max = Math.floor((w - margin * 2) / FONT[font][0])
    const t = fit(labelText(value), max)
    return `TEXT ${centerX(t.length, font)},${y},"${font}",0,1,1,"${t}"`
  }

  const blocks = jobs.map((job) => {
    const lines = ['CLS']
    let y = 8
    if (s.labelShowShopName && s.shopName) {
      lines.push(text(y, '1', s.shopName.toUpperCase()))
      y += 16
    }
    const name = labelText(job.name)
    const max2 = Math.floor((w - margin * 2) / FONT['2'][0])
    if (name.length <= max2) {
      lines.push(text(y, '2', name))
      y += 24
    } else {
      // Long part names: smaller font, wrapped onto two lines.
      const [l1, l2] = wrap(name, Math.floor((w - margin * 2) / FONT['1'][0]))
      lines.push(text(y, '1', l1))
      y += 14
      if (l2) {
        lines.push(text(y, '1', l2))
        y += 14
      }
      y += 2
    }
    if (s.labelShowPrice && job.price) {
      lines.push(text(y, '3', priceText(job.price, s.currency)))
      y += 28
    }
    const code = labelText(job.code)
    const modules = code128Widths(code).reduce((a, b) => a + b, 0)
    const narrow = Math.max(1, Math.min(3, Math.floor((w - margin * 2) / modules)))
    const barX = Math.max(4, Math.round((w - modules * narrow) / 2))
    const footer = 14 + 16 // human-readable code + SKU line
    const barH = Math.min(100, Math.max(32, h - y - footer - 10))
    lines.push(`BARCODE ${barX},${y + 2},"128",${barH},0,0,${narrow},${narrow},"${code}"`)
    y += barH + 6
    lines.push(text(y, '1', code))
    lines.push(text(y + 14, '1', `SKU ${job.sku}`))
    lines.push('PRINT 1,1')
    return lines.join('\r\n')
  })
  return [...header, ...blocks].join('\r\n') + '\r\n'
}

export function tsplBytes(jobs: LabelJob[], s: LabelSettings): Uint8Array {
  return new TextEncoder().encode(tsplLabels(jobs, s))
}

/** Feed to the next gap so the printer learns the label length (run after loading a new roll). */
export function tsplCalibrateBytes(s: LabelSettings): Uint8Array {
  return new TextEncoder().encode(
    [`SIZE ${s.labelWidthMm} mm,${s.labelHeightMm} mm`, `GAP ${s.labelGapMm} mm,0 mm`, 'GAPDETECT', 'HOME', ''].join('\r\n'),
  )
}

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** A printable HTML document with one label-sized page per job. */
export function labelsHtml(jobs: LabelJob[], s: LabelSettings): string {
  const pages = jobs
    .map((job) => {
      const code = labelText(job.code)
      return `<section class="label">
  ${s.labelShowShopName && s.shopName ? `<div class="shop">${esc(s.shopName)}</div>` : ''}
  <div class="name">${esc(job.name)}</div>
  ${s.labelShowPrice && job.price ? `<div class="price">${esc(priceText(job.price, s.currency))}</div>` : ''}
  <div class="bars">${code128Svg(code, { height: 60, moduleWidth: 2 })}</div>
  <div class="code">${esc(code)}</div>
  <div class="sku">SKU ${esc(job.sku)}</div>
</section>`
    })
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Barcode labels (${jobs.length})</title>
<style>
  @page { size: ${s.labelWidthMm}mm ${s.labelHeightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .label { width: ${s.labelWidthMm}mm; height: ${s.labelHeightMm}mm; padding: 1.2mm 1.5mm; overflow: hidden;
           display: flex; flex-direction: column; align-items: center; justify-content: space-between;
           page-break-after: always; break-after: page; text-align: center; }
  .label:last-child { page-break-after: auto; break-after: auto; }
  .shop { font-size: 6pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; }
  .name { font-size: 7.5pt; font-weight: bold; line-height: 1.1; max-height: 2.2em; overflow: hidden; }
  .price { font-size: 9pt; font-weight: 800; }
  .bars { width: 100%; flex: 1; min-height: 6mm; display: flex; }
  .bars svg { width: 100%; height: 100%; }
  .code { font-family: 'Courier New', monospace; font-size: 7pt; font-weight: bold; letter-spacing: 0.06em; }
  .sku { font-size: 5.5pt; }
  @media screen { body { background: #e5e7eb; padding: 12px; } .label { background: #fff; margin: 0 auto 8px; outline: 1px dashed #9ca3af; } }
</style></head><body>${pages}</body></html>`
}

/** Open the labels in a print window. Returns false when popups are blocked. */
export function printLabelsInBrowser(jobs: LabelJob[], s: LabelSettings): boolean {
  const w = window.open('', '_blank', 'width=480,height=640')
  if (!w) return false
  w.document.open()
  w.document.write(labelsHtml(jobs, s))
  w.document.close()
  // No inline script (the app's CSP forbids it): print from here once laid out.
  setTimeout(() => {
    w.focus()
    w.print()
  }, 350)
  return true
}
