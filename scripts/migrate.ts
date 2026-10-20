// Apply pending server DB migrations: npm run db:migrate
import { dbPath, migrate } from '../server/db'

const ran = migrate()
console.log(ran.length ? `Applied ${ran.length} migration(s): ${ran.join(', ')}` : 'Database is up to date')
console.log(`SQLite file: ${dbPath}`)
