import { useEffect, useState } from 'react'
import { NumPad } from '../components/ui'
import { PIN_LENGTH, useSession } from '../session'
import { useSettings } from '../db/settings'

export default function LoginPage() {
  const { login } = useSession()
  const settings = useSettings()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  const press = async (k: string) => {
    setError(false)
    if (k === '⌫') return setPin((p) => p.slice(0, -1))
    if (k === 'C') return setPin('')
    const next = (pin + k).slice(0, PIN_LENGTH)
    setPin(next)
    if (next.length === PIN_LENGTH && !(await login(next))) {
      setError(true)
      setPin('')
    }
  }

  // Physical keyboard support.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('⌫')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full items-center justify-center bg-white p-4">
      <div className="w-full max-w-xs text-center">
        <img src="logo.png" alt={settings.shopName} className="mx-auto mb-5 h-24 w-auto object-contain" />
        <h1 className="text-xl font-bold text-slate-900">{settings.shopName}</h1>
        <p className="mb-6 text-sm text-slate-500">Enter your PIN to start selling</p>
        <div className="mb-6 flex justify-center gap-3">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full shadow-[inset_2px_2px_4px_rgba(15,39,44,0.15),inset_-2px_-2px_4px_rgba(255,255,255,0.9)] ${
                error ? 'bg-red-100' : i < pin.length ? 'bg-brand-500' : 'bg-slate-100'
              }`}
            />
          ))}
        </div>
        {error && <p className="mb-3 text-sm font-medium text-red-500">Wrong PIN, try again</p>}
        <NumPad onKey={press} keys={['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']} />
        <p className="mt-6 text-xs text-slate-400">First run: owner PIN 1234, cashier PIN 0000. Change them in Settings → Users.</p>
      </div>
    </div>
  )
}
