import { describe, expect, it } from 'vitest'
import { EscPos, drawerKickBytes } from '../lib/escpos'
import { isValidMpesaCode, normalizePhone } from '../lib/mpesa'
import { parseCsv, toCsv } from '../lib/csv'
import { darajaTimestamp, stkPassword } from '../../server/daraja'

describe('ESC/POS', () => {
  it('pads left/right pairs to the paper width', () => {
    const bytes = new EscPos(32).pair('Subtotal', '1,700.00').build()
    const text = new TextDecoder().decode(bytes)
    expect(text).toBe('Subtotal' + ' '.repeat(32 - 8 - 8) + '1,700.00\n')
  })

  it('emits the standard drawer-kick pulse', () => {
    expect([...drawerKickBytes()]).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa])
  })
})

describe('M-Pesa helpers', () => {
  it('normalises Kenyan phone numbers', () => {
    expect(normalizePhone('0712 345 678')).toBe('254712345678')
    expect(normalizePhone('+254 110 000 000')).toBe('254110000000')
    expect(normalizePhone('12345')).toBeNull()
  })

  it('validates confirmation codes', () => {
    expect(isValidMpesaCode('sjk7ab12cd')).toBe(true)
    expect(isValidMpesaCode('SJK7AB')).toBe(false)
  })

  it('builds the Daraja password and EAT timestamp', () => {
    expect(darajaTimestamp(new Date('2026-01-01T21:30:05Z'))).toBe('20260102003005')
    expect(stkPassword('174379', 'key', '20260101000000')).toBe(Buffer.from('174379key20260101000000').toString('base64'))
  })
})

describe('CSV', () => {
  it('round-trips quoted fields', () => {
    const rows = [['sku', 'name'], ['A-1', 'Mirror, "chrome"\nset']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})
