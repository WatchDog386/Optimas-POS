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

            {/* OTP-style PIN boxes */}
            <div className="mt-8 flex items-center justify-center gap-4">
              <div className="relative">
                <div className="flex items-center gap-2.5">
                  {Array.from({ length: PIN_LENGTH }, (_, i) => {
                    const filled = i < pin.length
                    const active = focused && i === pin.length
                    return (
                      <span
                        key={i}
                        className={`grid h-14 w-14 place-items-center rounded-2xl text-2xl font-bold text-white ring-1 transition sm:h-16 sm:w-16 ${
                          active ? 'ring-cta ring-2' : filled ? 'ring-white/60' : 'ring-white/35'
                        }`}
                      >
                        {show ? (pin[i] ?? '') : filled ? '•' : ''}
                      </span>
                    )
                  })}
                </div>
                <input
                  id="pin-input"
                  type={show ? 'text' : 'password'}
                  inputMode="numeric"
                  autoFocus
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
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShow((s) => !s)}
                className="shrink-0 p-2 text-brand-300 transition hover:text-white"
                aria-label={show ? 'Hide PIN' : 'Show PIN'}
              >
                {show ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            {error ? (
              <p className="mt-3 text-center text-xs font-medium lowercase text-red-400">wrong pin, try again</p>
            ) : help ? (
              <p className="mx-auto mt-3 max-w-[20rem] text-center text-xs leading-relaxed lowercase text-brand-200/80">
                first run: owner <b className="text-white">1234</b>, cashier <b className="text-white">0000</b>. change them in staff.
              </p>
            ) : (
              <p className="mt-3 text-center text-xs lowercase text-white/55">enter your {PIN_LENGTH}-digit pin</p>
            )}

            {/* Login — solid white */}
            <button
              type="button"
              onClick={submit}
              disabled={pin.length !== PIN_LENGTH || busy}
              className="mt-6 w-full rounded-2xl bg-white py-3.5 text-sm font-bold lowercase tracking-[0.18em] text-ink shadow-[0_10px_24px_-12px_rgba(0,0,0,0.45)] transition duration-150 hover:bg-white/95 active:scale-[0.99] disabled:opacity-40"
            >
              login
            </button>

            {/* forgot pin? · not you? */}
            <div className="mt-4 flex items-center justify-between text-sm font-medium">
              <button
                type="button"
                onClick={() => setHelp((h) => !h)}
                className="lowercase text-brand-300 transition hover:text-white"
              >
                forgot pin?
              </button>
              <button
                type="button"
                onClick={() => {
                  setPin('')
                  setError(false)
                  setHelp(false)
                  document.getElementById('pin-input')?.focus()
                }}
                className="lowercase text-brand-300 transition hover:text-white"
              >
                not you?
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
