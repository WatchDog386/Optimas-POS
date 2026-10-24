// Browser fallback for barcode labels: when no raw (USB/serial/network) printer
// is configured, open a print window with a paper label showing the part name,
// price, SKU and the barcode number in a large scannable-style font.

export interface LabelData {
  name: string
  sku: string
  barcode?: string
  price?: number
  currency?: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, String.fromCharCode(38) + 'amp;')
    .replace(/</g, String.fromCharCode(38) + 'lt;')
    .replace(/>/g, String.fromCharCode(38) + 'gt;')
    .replace(/"/g, String.fromCharCode(38) + 'quot;')
}

const amt = (cents?: number) =>
  cents == null ? '' : (cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function labelHtml(l: LabelData): string {
  const price = l.price ? `${l.currency ?? 'KES'} ${amt(l.price)}` : ''
  return `
    <div class="label">
      <div class="name">${esc(l.name).slice(0, 40)}</div>
      ${price ? `<div class="price">${esc(price)}</div>` : ''}
      <div class="code">${esc(l.barcode || l.sku)}</div>
      <div class="sku">${esc(l.sku)}</div>
    </div>`
}

/** Open a print window with `copies` duplicate labels. Returns false if popups are blocked. */
export function printLabelsInBrowser(l: LabelData, copies = 1): boolean {
  const w = window.open('', '_blank', 'width=420,height=640')
  if (!w) return false
  const labels = Array.from({ length: Math.max(1, copies) }, () => labelHtml(l)).join('')
  w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode labels</title>
<style>
  @page { margin: 8mm; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; }
  .label {
    width: 58mm; padding: 3mm 2mm; margin: 0 auto 4mm;
    border: 1px dashed #999; text-align: center;
    page-break-inside: avoid; break-inside: avoid;
  }
  .name { font-size: 13px; font-weight: bold; }
  .price { font-size: 15px; font-weight: bold; margin-top: 1mm; }
  .code { font-family: 'Libre Barcode 128', 'Courier New', monospace; font-size: 22px;
          letter-spacing: 1px; margin-top: 2mm; font-weight: bold; }
  .sku { font-family: monospace; font-size: 11px; color: #333; }
</style>
</head>
<body>${labels}<script>window.onload = () => { window.print() }</script></body>
</html>`)
  w.document.close()
  return true
}
