import { describe, expect, it } from 'vitest'
import { code128Symbols, code128Widths, ean13CheckDigit, inStoreEan13, isValidEan13 } from '../lib/barcode'
import { labelText, tsplLabels } from '../lib/labels'
import { escposLabelBytes } from '../lib/escpos'
import { DEFAULT_SETTINGS } from '../db/settings'

/** Minimal Code 128 decoder (B/C subsets) to prove the encoder's output is self-consistent. */
function decode(symbols: number[]): string {
  const data = symbols.slice(0, -2)
  const check = symbols[symbols.length - 2]
  let sum = data[0]
  for (let i = 1; i < data.length; i++) sum += data[i] * i
  expect(sum % 103).toBe(check)
  expect(symbols[symbols.length - 1]).toBe(106)
  let set = data[0] === 105 ? 'C' : 'B'
  let out = ''
  for (const v of data.slice(1)) {
    if (v === 99) set = 'C'
    else if (v === 100) set = 'B'
    else out += set === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32)
  }
  return out
}

describe('Code 128', () => {
  it('round-trips text, digits and mixed codes', () => {
    for (const code of ['2100000000014', 'BRK-PAD-F', '14221-QBB1-A000', 'A1', '123456', '12345', 'AB123456CD', 'X 7']) {
      expect(decode(code128Symbols(code))).toBe(code)
    }
  })

  it('every symbol pattern is 11 modules wide (stop is 13)', () => {
    const widths = code128Widths('2100000000014')
    const symbols = code128Symbols('2100000000014')
    expect(widths.reduce((a, b) => a + b, 0)).toBe((symbols.length - 1) * 11 + 13)
  })

  it('uses compact subset C for long digit runs', () => {
    expect(code128Symbols('2100000000014')[0]).toBe(105)
    expect(code128Symbols('BRK')[0]).toBe(104)
  })

  it('rejects characters a scanner cannot read', () => {
    expect(() => code128Symbols('é')).toThrow()
    expect(() => code128Symbols('')).toThrow()
  })
})

describe('EAN-13', () => {
  it('computes check digits', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1) // 4006381333931 is a known valid EAN
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('4006381333932')).toBe(false)
  })

  it('makes in-store codes with the right prefix', () => {
    const c = inStoreEan13('21', 42, 37)
    expect(c).toHaveLength(13)
    expect(c.startsWith('213700000042')).toBe(true)
    expect(isValidEan13(c)).toBe(true)
  })
})

describe('label printing', () => {
  const s = { ...DEFAULT_SETTINGS, shopName: 'Test Spares' }
  const jobs = [
    { name: 'Brake pads "front"', sku: 'BRK-PAD-F', code: '2100000000014', price: 850_00 },
    { name: 'Brake pads "front"', sku: 'BRK-PAD-F', code: '2100000000021', price: 850_00 },
  ]

  it('emits one TSPL label per unit with its own serial', () => {
    const out = tsplLabels(jobs, s)
    expect(out.startsWith('SIZE 40 mm,30 mm\r\nGAP 2 mm,0 mm')).toBe(true)
    expect(out.match(/^PRINT 1,1$/gm)).toHaveLength(2)
    expect(out).toContain('"128"')
    expect(out).toContain(',"2100000000014"')
    expect(out).toContain(',"2100000000021"')
    // A double quote inside a TSPL string would end it early.
    expect(out).not.toMatch(/"Brake pads "front""/)
    expect(out).toContain("Brake pads 'front'")
  })

  it('keeps every TSPL element inside the label', () => {
    for (const size of [
      { labelWidthMm: 40, labelHeightMm: 30 },
      { labelWidthMm: 30, labelHeightMm: 20 },
      { labelWidthMm: 50, labelHeightMm: 25 },
    ]) {
      const out = tsplLabels([jobs[0]], { ...s, ...size })
      const w = size.labelWidthMm * 8
      const h = size.labelHeightMm * 8
      for (const m of out.matchAll(/^(?:TEXT|BARCODE) (\d+),(\d+)/gm)) {
        expect(Number(m[1])).toBeLessThan(w)
        expect(Number(m[2])).toBeLessThan(h)
      }
    }
  })

  it('wraps long part names instead of cutting them off', () => {
    const out = tsplLabels([{ ...jobs[0], name: 'Front brake pads for Ekon 450 and Commando' }], s)
    expect(out).toContain('"Front brake pads for Ekon 450 and"')
    expect(out).toContain('"Commando"')
  })

  it('cleans text for the printer', () => {
    expect(labelText('Café "Moto"\n')).toBe("Cafe 'Moto'")
  })

  it('builds ESC/POS labels with a proper GS k 73 barcode', () => {
    const bytes = [...escposLabelBytes([jobs[0]], s)]
    const i = bytes.findIndex((b, k) => b === 0x1d && bytes[k + 1] === 0x6b && bytes[k + 2] === 73)
    expect(i).toBeGreaterThan(0)
    const n = bytes[i + 3]
    const data = bytes.slice(i + 4, i + 4 + n)
    expect(String.fromCharCode(...data)).toBe('{B2100000000014')
  })
})
