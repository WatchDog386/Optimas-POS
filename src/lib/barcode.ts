// Barcode helpers: Code 128 encoding (for scannable labels rendered as SVG in
// the browser fallback) and EAN-13 numbers for codes the shop generates itself.

// Bar/space widths for Code 128 symbols 0–106 (106 = stop, without the final bar).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]
const START_B = 104
const START_C = 105
const CODE_B = 100
const CODE_C = 99
const STOP = 106

const isDigit = (c: string) => c >= '0' && c <= '9'

function digitRun(s: string, i: number): number {
  let n = 0
  while (i + n < s.length && isDigit(s[i + n])) n++
  return n
}

/**
 * Encode printable ASCII (32–126) as Code 128 symbol values, switching to
 * subset C for runs of digits (half the width) as scanners expect.
 */
export function code128Symbols(text: string): number[] {
  if (!text) throw new Error('Barcode text is empty')
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if (c < 32 || c > 126) throw new Error(`Character "${ch}" cannot be printed in a Code 128 barcode`)
  }
  const out: number[] = []
  let i = 0
  let set: 'B' | 'C'
  const lead = digitRun(text, 0)
  if (lead >= 4 && (lead === text.length || lead >= 6) ) {
    set = 'C'
    out.push(START_C)
  } else {
    set = 'B'
    out.push(START_B)
  }
  while (i < text.length) {
    const run = digitRun(text, i)
    if (set === 'B' && run >= 4 && (run >= 6 || i + run === text.length)) {
      // An odd run: emit the first digit in B so the rest pairs up in C.
      if (run % 2 === 1) {
        out.push(text.charCodeAt(i) - 32)
        i++
      }
      out.push(CODE_C)
      set = 'C'
      continue
    }
    if (set === 'C') {
      if (run >= 2) {
        out.push(Number(text.slice(i, i + 2)))
        i += 2
        continue
      }
      out.push(CODE_B)
      set = 'B'
      continue
    }
    out.push(text.charCodeAt(i) - 32)
    i++
  }
  let sum = out[0]
  for (let k = 1; k < out.length; k++) sum += out[k] * k
  out.push(sum % 103, STOP)
  return out
}

/** Module widths (bar, space, bar, …) including quiet zones of 10 modules. */
export function code128Widths(text: string): number[] {
  const widths: number[] = []
  for (const sym of code128Symbols(text)) for (const w of PATTERNS[sym]) widths.push(Number(w))
  return widths
}

/** Self-contained SVG markup for a Code 128 barcode. */
export function code128Svg(text: string, opts: { height?: number; moduleWidth?: number } = {}): string {
  const height = opts.height ?? 40
  const mw = opts.moduleWidth ?? 1
  const quiet = 10
  const widths = code128Widths(text)
  const total = widths.reduce((s, w) => s + w, 0) + quiet * 2
  let x = quiet
  let rects = ''
  widths.forEach((w, idx) => {
    if (idx % 2 === 0) rects += `<rect x="${x * mw}" y="0" width="${w * mw}" height="${height}"/>`
    x += w
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total * mw} ${height}" width="${total * mw}" height="${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`
}

/** EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits before the check digit')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/**
 * In-store EAN-13 (GS1 prefixes 20–29 are reserved for internal use, so these
 * never collide with a manufacturer's barcode).
 *   20… product barcodes   21… per-unit serial labels
 * Layout: prefix(2) + till(2) + counter(8) + check digit. The till number keeps
 * two tills that each number their own labels from printing the same serial.
 */
export function inStoreEan13(prefix: '20' | '21', n: number, till = 0): string {
  if (!Number.isInteger(n) || n < 0 || n > 99_999_999) throw new Error('Barcode counter out of range')
  if (!Number.isInteger(till) || till < 0 || till > 99) throw new Error('Till number out of range')
  const body = prefix + String(till).padStart(2, '0') + String(n).padStart(8, '0')
  return body + ean13CheckDigit(body)
}
