// Emergency staff reset for the shop server.
// Sets exactly these accounts (same IDs as the till's records):
//   id 1                Optimas Admin  owner
//   id 53381337737504   Rose           owner
//   id 53196109797664   Denis          cashier
//
//   npm run staff:reset -- <adminPin> <rosePin> <denisPin>
//   e.g.  npm run staff:reset -- 0735 070345 1987

import crypto from 'node:crypto'
import { migrate, sql } from '../server/db'

migrate()

const pins = process.argv.slice(2)
if (pins.length !== 3) {
  console.error('Usage: npm run staff:reset -- <adminPin> <rosePin> <denisPin>')
  console.error('e.g.   npm run staff:reset -- 0735 070345 1987')
  process.exit(1)
}
for (const p of pins) {
  if (!/^\d{4,6}$/.test(p)) {
    console.error(`Bad PIN "${p}" — use 4 to 6 digits (digits only).`)
    process.exit(1)
  }
}

const hash = (pin: string): string => {
  const salt = crypto.randomBytes(16)
  const iterations = 30_000
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${crypto.pbkdf2Sync(pin, salt, iterations, 32, 'sha256').toString('base64')}`
}

const accounts = [
  { id: 1, name: 'Optimas Admin', role: 'owner', pin: pins[0] },
  { id: 53381337737504, name: 'Rose', role: 'owner', pin: pins[1] },
  { id: 53196109797664, name: 'Denis', role: 'cashier', pin: pins[2] },
]

sql.transaction(() => {
  const upsert = sql.prepare(
    `INSERT INTO users (id, name, pin_hash, role, active, must_change_pin, updated_at)
     VALUES (@id, @name, @pin_hash, @role, 1, 0, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, pin_hash = excluded.pin_hash, role = excluded.role,
       active = 1, must_change_pin = 0, updated_at = excluded.updated_at`,
  )
  for (const a of accounts) {
    upsert.run({ id: a.id, name: a.name, role: a.role, pin_hash: hash(a.pin), updated_at: Date.now() })
    console.log(`set  ${a.name} (${a.role}, id ${a.id})  PIN  ${a.pin.replace(/./g, '•')}`)
  }
})()

console.log('\nDone. Every device that signs in against this server now accepts those PINs.')
console.log('On the till: if Optimas Admin still refuses its PIN there, sign in as Rose and set')
console.log('the admin PIN under Staff → Optimas Admin (that pushes the same fix to the server).')
