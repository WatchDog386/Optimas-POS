import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { db } from './db/db'
import { SessionProvider } from './session'
import { ToastProvider } from './components/ui'
import { initAutoFullscreen } from './lib/fullscreen'

initAutoFullscreen()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Open (and if needed migrate) the database before the first render.
db.open()
  .catch((e) => console.error('Database failed to open', e))
  .finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <ToastProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ToastProvider>
      </BrowserRouter>
    </StrictMode>,
  )
})
