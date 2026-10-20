import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { PIN_LENGTH, useSession } from '../session'
import { useSettings } from '../db/settings'

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']

export default function LoginPage() {
  const { login } = useSession()
  const settings = useSettings()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [help, setHelp] = useState(false)

  const press = (k: string) => {
    setError(false)
    if (k === '⌫') return setPin((p) => p.slice(0, -1))
    if (k === 'C') return setPin('')
    setPin((p) => (p + k).slice(0, PIN_LENGTH))
  }

  const submit = async () => {
    if (busy || pin.length !== PIN_LENGTH) return
    setBusy(true)
    const ok = await login(pin)
    if (!ok) {
      setError(true)
      setPin('')
      setBusy(false)
    }
  }

  // Physical keyboard support. When the PIN field itself has focus, the input
  // handles digits/backspace natively — appending here as well would double them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === 'Enter') {
        e.preventDefault()
        void submit()
        return
      }
      if (inField) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('⌫')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full items-center justify-center overflow-hidden bg-mist p-4 sm:p-6">
      {/* ===================================================== Auth card */}
      <div className="grid h-full max-h-[780px] w-full max-w-7xl grid-cols-1 overflow-visible shadow-[0_35px_90px_-20px_rgba(15,39,44,0.45)] md:grid-cols-[45fr_55fr]">
        {/* ------------------------------------------------- Left: hero art */}
        <aside className="relative hidden items-center justify-center overflow-visible bg-white md:flex">
          {/* background text — sits behind the artwork */}
          <div className="pointer-events-none absolute left-0 top-0 p-6 text-left">
            <span className="truncate text-2xl font-medium capitalize tracking-tight text-ink">
              {settings.shopName}
            </span>
          </div>

          <img
            src="login.png"
            alt=""
            className="absolute bottom-[-7%] left-[-9%] z-10 h-[116%] w-auto max-w-none object-contain"
          />
        </aside>

        {/* ------------------------------------------------- Right: sign in */}
        <main className="relative flex flex-col overflow-y-auto bg-ink p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-8">
          <div className="relative m-auto w-[460px] max-w-full py-2">
            {/* small-screen logo */}
            <div className="mb-5 flex justify-center md:hidden">
              <span className="flex items-center gap-2.5">
                <img src="logo.png" alt="" className="h-9 w-9 object-contain" />
                <span className="text-[16px] font-bold text-white">{settings.shopName}</span>
              </span>
            </div>

            <h2 className="text-center text-[30px] font-bold leading-tight tracking-tight text-white sm:text-[36px]">
              Welcome back!
            </h2>
            <p className="mt-1.5 text-center text-[16px] text-white/55">Enter your staff PIN to continue</p>

            {/* PIN field */}
            <div className="mt-7 sm:mt-10">
              <div className="flex items-baseline justify-between">
                <label htmlFor="pin-input" className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                  Staff PIN
                </label>
                <button type="button" onClick={() => setHelp((h) => !h)} className="text-[13px] font-medium text-brand-300 transition hover:text-white">
                  Forgot PIN?
                </button>
              </div>
              <div className="flex items-center border-b border-white/20 transition focus-within:border-brand-300">
                <input
                  id="pin-input"
                  type={show ? 'text' : 'password'}
                  inputMode="none"
                  autoFocus
                  value={pin}
                  onChange={(e) => {
                    setError(false)
                    setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))
                  }}
                  placeholder="••••"
                  className={`w-full bg-transparent py-2.5 text-lg tracking-[0.4em] text-white placeholder:text-white/45 focus:outline-none ${
                    show ? 'font-mono tracking-[0.3em]' : ''
                  }`}
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="p-1 text-white/55 transition hover:text-white/90" aria-label={show ? 'Hide PIN' : 'Show PIN'}>
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {error ? (
                <p className="mt-2 text-sm font-medium text-red-400">Wrong PIN, try again</p>
              ) : help ? (
                <p className="mt-2 text-xs leading-relaxed text-brand-200/80">
                  First run: owner <b className="text-white">1234</b>, cashier <b className="text-white">0000</b>. Change them in Staff.
                </p>
              ) : (
                <p className="mt-2 text-xs text-white/55">Enter your {PIN_LENGTH}-digit PIN</p>
              )}
            </div>

            {/* On-screen keypad — phones and tablets have no reliable keyboard to tap into */}
            <div className="mt-5 grid grid-cols-3 gap-2 lg:hidden">
              {KEYPAD.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  className={`h-14 rounded-xl border border-white/10 text-xl font-semibold transition active:scale-95 ${
                    k === 'C' || k === '⌫' ? 'bg-white/[0.07] text-white/70' : 'bg-white/[0.04] text-white'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>

            {/* SIGN IN */}
            <button
              type="button"
              onClick={submit}
              disabled={pin.length !== PIN_LENGTH || busy}
              className="mt-6 w-full rounded-xl bg-cta py-4 text-[13px] font-bold uppercase tracking-[0.25em] text-white shadow-[0_12px_28px_-12px_rgba(0,0,0,0.6)] transition duration-150 hover:bg-cta-hover active:scale-[0.99] disabled:opacity-40 disabled:shadow-none sm:mt-8 sm:py-3.5"
            >
              Login
            </button>

            {/* OR */}
            <div className="my-4 flex items-center gap-3 sm:my-5">
              <div className="h-px flex-1 bg-white/15" />
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/60">or</span>
              <div className="h-px flex-1 bg-white/15" />
            </div>

            {/* secondary — switch staff (same slot as “Continue with Google”) */}
            <button
              type="button"
              onClick={() => {
                setPin('')
                setError(false)
                setHelp(false)
                document.getElementById('pin-input')?.focus()
              }}
              className="w-full rounded border border-white/20 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06] active:bg-white/10"
            >
              Use another staff PIN
            </button>

            {/* footer */}
            <p className="mt-5 text-center text-[13px] text-white/60 sm:mt-6">
              First run? <span className="font-bold text-cta">OWNER 1234</span>
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
