import { describe, expect, it } from 'vitest'
import { createHash, pbkdf2Sync } from 'node:crypto'
import { hashPin, isPinHash, pbkdf2Sha256, sha256, verifyPin, weakPinReason } from '../lib/pinHash'
import { verifyPinHash } from '../../server/auth'

const enc = new TextEncoder()

describe('PIN hashing', () => {
  it('SHA-256 matches node:crypto across block boundaries', () => {
    for (const len of [0, 3, 55, 56, 63, 64, 65, 200]) {
      const s = 'x'.repeat(len)
      expect(Buffer.from(sha256(enc.encode(s))).toString('hex')).toBe(createHash('sha256').update(s).digest('hex'))
    }
  })

  it('PBKDF2 matches node:crypto', () => {
    const salt = Buffer.from('0123456789abcdef')
    for (const [pin, it] of [['1234', 1], ['987654', 1000], ['p'.repeat(90), 3]] as const) {
      expect(Buffer.from(pbkdf2Sha256(enc.encode(pin), salt, it)).toString('hex')).toBe(pbkdf2Sync(pin, salt, it, 32, 'sha256').toString('hex'))
    }
  })

  it('verifies only the right PIN, with a fresh salt every time', () => {
    const a = hashPin('5821', 2000)
    const b = hashPin('5821', 2000)
    expect(isPinHash(a)).toBe(true)
    expect(a).not.toBe(b)
    expect(verifyPin('5821', a)).toBe(true)
    expect(verifyPin('5822', a)).toBe(false)
    expect(verifyPin('5821', 'garbage')).toBe(false)
    expect(verifyPin('5821', undefined)).toBe(false)
  })

  it('records made on the till verify on the server', () => {
    const rec = hashPin('739104', 2000)
    expect(verifyPinHash('739104', rec)).toBe(true)
    expect(verifyPinHash('739105', rec)).toBe(false)
  })

  it('rejects weak PINs', () => {
    expect(weakPinReason('1234')).toMatch(/sequence/)
    expect(weakPinReason('4321')).toMatch(/sequence/)
    expect(weakPinReason('0000')).toMatch(/repeated/)
    expect(weakPinReason('12a4')).toMatch(/digits/)
    expect(weakPinReason('123')).toMatch(/digits/)
    expect(weakPinReason('5821')).toBeNull()
    expect(weakPinReason('739104')).toBeNull()
  })
})

describe('username matching', async () => {
  const { matchStaff } = await import('../pages/LoginPage')
  const staff = [
    { id: 1, name: 'Optimas Admin' },
    { id: 2, name: 'Cashier' },
  ]
  it('accepts the staff name in any case or spacing, or one unique word of it', () => {
    expect(matchStaff(staff, 'Optimas Admin')?.id).toBe(1)
    expect(matchStaff(staff, '  optimas   ADMIN ')?.id).toBe(1)
    expect(matchStaff(staff, 'admin')?.id).toBe(1)
    expect(matchStaff(staff, 'optimas')?.id).toBe(1)
    expect(matchStaff(staff, 'cash')?.id).toBe(2)
    expect(matchStaff(staff, '')).toBeUndefined()
    expect(matchStaff(staff, 'manager')).toBeUndefined()
  })
  it('refuses an ambiguous partial name', () => {
    expect(matchStaff([...staff, { id: 3, name: 'Cash Office' }], 'cash')).toBeUndefined()
  })
})
