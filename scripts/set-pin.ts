// Set a staff member's PIN on the shop server — every till uses it from the
// next online sign-in:
//   npm run staff:pin -- "Optimas Admin" 3430
//   npm run staff:pin -- --list
import { migrate, sql } from '../server/db'
import { hashPin, weakPinReason } from '../src/lib/pinHash'

migrate()
const [name, pin] = process.argv.slice(2)
const users = sql.prepare('SELECT id, name, role, active FROM users ORDER BY id').all() as { id: number; name: string; role: string; active: number }[]

if (!name || name === '--list') {
  console.log('Staff on the server:')
  for (const u of users) console.log(`  ${u.name} (${u.role})${u.active ? '' : ' — disabled'}`)
  console.log('\nSet a PIN with: npm run staff:pin -- "<name>" <pin>')
  process.exit(0)
}

const matches = users.filter((u) => u.name.trim().toLowerCase() === name.trim().toLowerCase())
if (matches.length !== 1) {
  console.error(matches.length ? `More than one staff member is called "${name}".` : `No staff member called "${name}". Staff: ${users.map((u) => u.name).join(', ')}`)
  process.exit(1)
}
const weak = weakPinReason(pin ?? '')
if (weak) {
  console.error(weak)
  process.exit(1)
}
sql.prepare('UPDATE users SET pin_hash = ?, must_change_pin = 0, updated_at = ? WHERE id = ?').run(hashPin(pin), Date.now(), matches[0].id)
console.log(`PIN updated for ${matches[0].name}. It works on every till from the next sign-in.`)
