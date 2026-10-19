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
    <div className="flex h-full items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-xs text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 text-2xl font-black">O</div>
        <h1 className="text-xl font-bold text-white">{settings.shopName}</h1>
        <p className="mb-6 text-sm text-slate-400">Enter your PIN to start selling</p>
        <div className="mb-6 flex justify-center gap-3">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? 'bg-brand-500' : 'bg-slate-700'} ${error ? 'bg-red-500' : ''}`} />
          ))}
        </div>
        {error && <p className="mb-3 text-sm text-red-400">Wrong PIN, try again</p>}
        <NumPad onKey={press} keys={['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']} />
        <p className="mt-6 text-xs text-slate-500">First run: owner PIN 1234, cashier PIN 0000. Change them in Settings → Users.</p>
      </div>
    </div>
  )
}
