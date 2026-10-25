// Optimas POS local server — process entry point. Configure with a .env file
// next to package.json (see .env.example).

import { createApp } from './app'
import { dbPath, migrate } from './db'
import * as pinpay from './pinpay'

try {
  process.loadEnvFile()
} catch {
  // No .env file; rely on the real environment.
}

const migrated = migrate()
if (migrated.length) console.log(`DB migrations applied: ${migrated.join(', ')}`)

const { app, daraja, distBuilt } = createApp()
const PORT = Number(process.env.PORT ?? 8787)
// HOST=127.0.0.1 keeps the API private behind a reverse proxy.
const HOST = process.env.HOST || '0.0.0.0'

app.listen(PORT, HOST, () => {
  console.log(`Optimas POS server on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  console.log(`Database: ${dbPath}`)
  console.log(
    `M-Pesa: ${
      pinpay.payConfigured()
        ? `pay gateway (${pinpay.payEndpoint()})`
        : daraja.configured
          ? `${daraja.env} (${process.env.MPESA_SHORTCODE})`
          : 'not configured — manual code entry only'
    }`,
  )
  if (!distBuilt) console.log('dist/ not built yet: run "npm run build" to serve the app from here, or use "npm run dev".')
})
