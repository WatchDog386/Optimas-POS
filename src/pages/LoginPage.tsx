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
    <div className="relative flex h-full items-stretch overflow-hidden bg-ink md:items-center md:justify-center md:bg-mist md:p-4 lg:p-6">
      {/* Mobile: the hero image fills the screen and sits behind everything */}
      <img src="login.png" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center md:hidden" />
      <div className="pointer-events-none absolute inset-0 bg-ink/75 md:hidden" />

      {/* ===================================================== Auth card */}
      <div className="relative grid h-full w-full grid-cols-1 overflow-visible md:max-h-[780px] md:max-w-7xl md:shadow-[0_35px_90px_-20px_rgba(15,39,44,0.45)] md:grid-cols-[45fr_55fr]">
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
        <main className="relative flex flex-col overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-8 md:bg-ink">
          <div className="relative m-auto w-[420px] max-w-full py-2">
            <p className="text-center text-[30px] font-bold lowercase leading-tight tracking-tight text-white sm:text-[36px]">
              enter your pin to continue
            </p>

            {/* PIN bar */}
            <div className="mt-8 flex items-center gap-2 rounded-2xl bg-white/[0.07] px-4 py-3.5 ring-1 ring-white/20 backdrop-blur-[2px] transition focus-within:ring-brand-300">
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
                className={`w-full bg-transparent py-1 text-sm tracking-[0.4em] text-white placeholder:text-white/45 focus:outline-none ${
                  show ? 'font-mono tracking-[0.3em]' : ''
                }`}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="shrink-0 p-1 text-white/55 transition hover:text-white/90"
                aria-label={show ? 'Hide PIN' : 'Show PIN'}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {error ? (
              <p className="mt-2 text-xs font-medium lowercase text-red-400">wrong pin, try again</p>
            ) : help ? (
              <p className="mt-2 text-xs leading-relaxed lowercase text-brand-200/80">
                first run: owner <b className="text-white">1234</b>, cashier <b className="text-white">0000</b>. change them in staff.
              </p>
            ) : (
              <p className="mt-2 text-xs lowercase text-white/55">enter your {PIN_LENGTH}-digit pin</p>
            )}

            {/* On-screen keypad — phones and tablets have no reliable keyboard to tap into */}
            <div className="mt-5 grid grid-cols-3 gap-2 lg:hidden">
              {KEYPAD.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  className="h-14 rounded-2xl bg-white/[0.06] text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/[0.10] active:scale-95"
                >
                  {k}
                </button>
              ))}
            </div>

            {/* Login — see-through */}
            <button
              type="button"
              onClick={submit}
              disabled={pin.length !== PIN_LENGTH || busy}
              className="mt-6 w-full rounded-2xl bg-white/[0.10] py-3.5 text-sm font-bold lowercase tracking-[0.18em] text-white ring-1 ring-white/25 transition duration-150 hover:bg-white/[0.16] active:scale-[0.99] disabled:opacity-40"
            >
              login
            </button>

            {/* Forgot PIN — under the login button */}
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setHelp((h) => !h)}
                className="text-sm font-medium lowercase text-brand-300 transition hover:text-white"
              >
                forgot pin?
              </button>
            </div>

            {/* secondary — switch staff */}
            <button
              type="button"
              onClick={() => {
                setPin('')
                setError(false)
                setHelp(false)
                document.getElementById('pin-input')?.focus()
              }}
              className="mt-6 w-full rounded-2xl bg-cta py-3 text-sm font-semibold lowercase text-white shadow-[0_10px_24px_-12px_rgba(31,195,65,0.9)] transition hover:bg-cta-hover active:scale-[0.99]"
            >
              use another staff pin
            </button>
          </div>
        </main>
      </div>
    </div>
  )
}
