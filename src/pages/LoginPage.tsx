import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { PIN_LENGTH, useSession } from '../session'
import { useSettings } from '../db/settings'

export default function LoginPage() {
  const { login } = useSession()
  const settings = useSettings()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [help, setHelp] = useState(false)
  const [focused, setFocused] = useState(true)

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

  /** Focus whichever PIN field is actually on screen (mobile vs desktop markup). */
  const focusInput = () => {
    for (const id of ['pin-input-m', 'pin-input']) {
      const el = document.getElementById(id) as HTMLInputElement | null
      if (el && el.offsetParent !== null) {
        el.focus()
        return
      }
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

  // The mobile field is the one on screen for phones — keep it focused for the
  // native number pad. (Desktop keeps its original autoFocus attribute.)
  useEffect(() => {
    focusInput()
  }, [])

  return (
    <>
      {/* ============================================================
          MOBILE — hero image in frame at the top, sign-in sheet below.
          ============================================================ */}
      <div className="relative flex h-full flex-col overflow-hidden bg-ink md:hidden">
        {/* hero image, held in the top of the frame */}
        <div className="relative h-[52%] shrink-0">
          <img src="login.png" alt="" className="h-full w-full object-cover object-top" />
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink via-ink/60 to-transparent" />
        </div>

        {/* sign-in sheet */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-ink px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mt-auto mb-20 w-full">
            <p className="text-center text-sm text-white/70">Enter PIN</p>

            {/* OTP-style PIN boxes */}
            <div className="relative mt-5">
              <div className="flex items-center justify-center gap-2.5">
                {Array.from({ length: PIN_LENGTH }, (_, i) => {
                  const filled = i < pin.length
                  const active = focused && i === pin.length
                  return (
                    <span
                      key={i}
                      className={`grid h-14 w-14 place-items-center rounded-2xl text-2xl font-bold text-white ring-1 transition ${
                        active ? 'ring-cta ring-2' : filled ? 'ring-white/60' : 'ring-white/35'
                      }`}
                    >
                      {filled ? '•' : ''}
                    </span>
                  )
                })}
              </div>
              <input
                id="pin-input-m"
                type="password"
                inputMode="numeric"
                value={pin}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(e) => {
                  setError(false)
                  setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))
                }}
                aria-label="Staff PIN"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </div>

            {error ? (
              <p className="mt-3 text-center text-xs font-medium text-red-400">Wrong PIN, try again</p>
            ) : help ? (
              <p className="mt-3 text-center text-xs leading-relaxed text-brand-200/80">
                First run: owner <b className="text-white">1234</b>, cashier <b className="text-white">0000</b>. Change them in Staff.
              </p>
            ) : null}

            {/* Login — dashboard header blue */}
            <button
              type="button"
              onClick={submit}
              disabled={pin.length !== PIN_LENGTH || busy}
              className="mt-5 w-full rounded-2xl bg-[#2f63a8] py-3.5 text-sm font-bold text-white transition duration-150 hover:bg-[#2a5896] active:scale-[0.99]"
            >
              Login
            </button>

            {/* forgot pin? · not you? */}
            <div className="mt-4 flex items-center justify-between pb-1 text-sm font-medium">
              <button type="button" onClick={() => setHelp((h) => !h)} className="text-brand-300 transition hover:text-white">
                Forgot PIN?
              </button>
              <button
                type="button"
                onClick={() => {
                  setPin('')
                  setError(false)
                  setHelp(false)
                  focusInput()
                }}
                className="text-brand-300 transition hover:text-white"
              >
                Not you?
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          DESKTOP — original layout, untouched.
          ============================================================ */}
      <div className="relative hidden h-full items-center justify-center overflow-hidden bg-mist p-4 sm:p-6 md:flex">
        {/* ===================================================== Auth card */}
        <div className="grid h-full max-h-[660px] w-full max-w-5xl grid-cols-1 overflow-visible shadow-[0_35px_90px_-20px_rgba(15,39,44,0.45)] md:grid-cols-[45fr_55fr]">
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
          <main className="relative flex items-center justify-center overflow-y-auto bg-ink p-6 sm:p-8">
            <div className="relative w-[460px] max-w-full">
              <h2 className="text-center text-[36px] font-bold leading-tight tracking-tight text-white">Welcome back!</h2>
              <p className="mt-1.5 text-center text-[16px] text-white/55">Enter your staff PIN to continue</p>

              {/* PIN field */}
              <div className="mt-10">
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
                    inputMode="numeric"
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

              {/* SIGN IN */}
              <button
                type="button"
                onClick={submit}
                disabled={pin.length !== PIN_LENGTH || busy}
                className="mt-8 w-full rounded-xl bg-cta py-3.5 text-[13px] font-bold uppercase tracking-[0.25em] text-white shadow-[0_12px_28px_-12px_rgba(0,0,0,0.6)] transition duration-150 hover:bg-cta-hover active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
              >
                Login
              </button>

              {/* OR */}
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/15" />
                <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/60">or</span>
                <div className="h-px flex-1 bg-white/15" />
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
                className="w-full rounded border border-white/20 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
              >
                Use another staff PIN
              </button>

              {/* footer */}
              <p className="mt-6 text-center text-[13px] text-white/60">
                First run? <span className="font-bold text-cta">OWNER 1234</span>
              </p>
            </div>
          </main>
        </div>
      </div>
    </>
  )
}
