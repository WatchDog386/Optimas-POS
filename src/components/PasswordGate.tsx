import { useState, type FormEvent, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { verifyPin } from '../lib/pinHash'

/** Purchasing page password (stored only as a salted PBKDF2 hash). */
export const PURCHASING_PASSWORD_HASH = 'pbkdf2-sha256$200000$rJY9ZL114F524POVY3um2A==$ZiSUCPNSu0BxUVXikwkiYM1o9ERFABtH8FzyPdIE/nk='

const unlocked = new Set<string>()

/** Asks for a password before showing a page; stays unlocked until the app is reloaded or the till is locked. */
export function PasswordGate({ id, hash, title, children }: { id: string; hash: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => unlocked.has(id))
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (open) return <>{children}</>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await new Promise((r) => setTimeout(r, 30)) // let the spinner paint before hashing
    if (verifyPin(value, hash)) {
      unlocked.add(id)
      setOpen(true)
    } else {
      setError('Wrong password')
      setValue('')
    }
    setBusy(false)
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-slate-800">
          <Lock size={18} className="text-brand-600" />
          <h2 className="text-lg font-bold">{title}</h2>
        </div>
        <label className="label">Password</label>
        <input className="input" type="password" autoFocus autoComplete="off" value={value} onChange={(e) => { setValue(e.target.value); setError('') }} />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button className="btn-primary mt-4 w-full" disabled={busy || !value}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}

/** Forget unlocked pages (called when the till locks). */
export function relockGates() {
  unlocked.clear()
}
