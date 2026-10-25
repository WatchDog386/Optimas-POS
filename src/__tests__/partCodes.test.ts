import { describe, expect, it } from 'vitest'
import { DEFAULT_SKU, nextCode } from '../lib/partCodes'

describe('nextCode', () => {
  it('starts from the default when nothing is keyed in yet', () => {
    expect(nextCode([], DEFAULT_SKU)).toBe('SPR-0001')
    expect(nextCode(['', undefined, 'BRAKE'], DEFAULT_SKU)).toBe('SPR-0001')
  })

  it('continues the pattern of the most recently added part', () => {
    expect(nextCode(['SPR-0041', 'SPR-0007', 'OLD-9'], DEFAULT_SKU)).toBe('SPR-0042')
    expect(nextCode(['spr-0041'], DEFAULT_SKU)).toBe('SPR-0042')
    expect(nextCode(['BRK12A', 'BRK40A', 'SPR-0002'], DEFAULT_SKU)).toBe('BRK41A')
  })

  it('uses the highest number in the series, keeps zero padding and grows past it', () => {
    expect(nextCode(['P-003', 'P-120', 'P-009'], DEFAULT_SKU)).toBe('P-121')
    expect(nextCode(['P-99'], DEFAULT_SKU)).toBe('P-100')
  })
})
