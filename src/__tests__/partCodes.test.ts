import { describe, expect, it } from 'vitest'
import { nextNumber } from '../lib/partCodes'

describe('nextNumber', () => {
  it('starts at 0001', () => {
    expect(nextNumber([])).toBe('0001')
    expect(nextNumber(['', undefined, 'BRAKE-PAD'])).toBe('0001')
  })

  it('continues after the highest number', () => {
    expect(nextNumber(['0001', '0007', '0003'])).toBe('0008')
    expect(nextNumber(['0041', 'OEM-77'])).toBe('0042')
    expect(nextNumber(['9999'])).toBe('10000')
  })
})
