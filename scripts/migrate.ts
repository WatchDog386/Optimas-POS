// Apply pending server DB migrations: npm run db:migrate
import { dbPath, migrate, seedDefaultStaff } from '../server/db'

const ran = migrate()
console.log(ran.length ? `Applied ${ran.length} migration(s): ${ran.join(', ')}` : 'Database is up to date')
if (seedDefaultStaff()) console.log('Staff accounts set: Optimas Admin, Cashier')
console.log(`SQLite file: ${dbPath}`)
