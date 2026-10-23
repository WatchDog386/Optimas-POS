import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { seedIfEmpty, backfillSampleImages } from './db/seed'
import { importQuotationProducts } from './db/quotationProducts'
import { SessionProvider } from './session'
import { ToastProvider } from './components/ui'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

seedIfEmpty()
  .then(() => importQuotationProducts())
  .then(() => backfillSampleImages())
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
