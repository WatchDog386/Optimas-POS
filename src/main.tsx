import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { seedIfEmpty, backfillSampleImages } from './db/seed'
import { SessionProvider } from './session'
import { ToastProvider } from './components/ui'

seedIfEmpty()
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
