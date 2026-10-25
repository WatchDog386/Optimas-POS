import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Eye, EyeOff, Loader2 } from 'lucide-react'
import { db } from '../db/db'
import { saveSettings, useSettings } from '../db/settings'
import { createOwner, needsSetup } from '../db/seed'
import { logActivity } from '../db/logs'
import { hashPin, verifyPin, weakPinReason } from '../lib/pinHash'
import { pushOwnPin, serverStaff, signInFromServer } from '../lib/api'
import { PIN_MAX, PIN_MIN, formatWait, lockRemaining, useSession } from '../session'
import type { Role, User } from '../db/types'

type Staff = { id: number; name: string; role: Role }
type Mode = { kind: 'loading' } | { kind: 'local' } | { kind: 'server'; staff: Staff[] } | { kind: 'setup' }

const LAST_USER_KEY = 'optimas.lastUser'
const APP_VERSION = '1.0.0'
const ROLE_LABEL: Record<Role, string> = { owner: 'Admin', manager: 'Manager', cashier: 'Cashier' }

export default function LoginPage() {
  const localUsers = useLiveQuery(() => db.users.toArray(), [], undefined)
  const [mode, setMode] = useState<Mode>({ kind: 'loading' })

  // Decide what this till needs: normal sign-in, sign-in against the shop
  // server (a new till for an existing shop), or first-run owner setup.
  useEffect(() => {
    if (localUsers === undefined) return
    let alive = true
    void (async () => {
      if (!(await needsSetup())) {
        if (alive) setMode({ kind: 'local' })
        return
      }
      try {
        const staff = await serverStaff()
        if (alive && staff.length > 0) {
          setMode({ kind: 'server', staff })
          return
        }
      } catch {
        // Server unreachable — set the till up on its own.
      }
      if (alive) setMode({ kind: 'setup' })
    })()
    return () => {
      alive = false
    }
  }, [localUsers])

  return (
    <AuthShell>
      {mode.kind === 'loading' && <Loader2 className="mx-auto mt-6 animate-spin text-white/80" size={26} />}
      {mode.kind === 'local' && <SignIn staff={(localUsers ?? []).filter((u) => u.active).map((u) => ({ id: u.id!, name: u.name, role: u.role }))} source="local" />}
      {mode.kind === 'server' && <SignIn staff={mode.staff} source="server" />}
      {mode.kind === 'setup' && <SetupOwner />}
    </AuthShell>
  )
}

// ----------------------------------------------------------------- layout

/** The Optimas mark: a white ring with a break and a dot, in the style of the reference design. */
function OptimasMark() {
  return (
    <svg viewBox="0 0 100 100" className="mx-auto h-[112px] w-[112px] sm:h-[140px] sm:w-[140px]" role="img" aria-label="Optimas">
      {/* Ring open at the lower right, its end running out into a short tail, then a dot. */}
      <path d="M88 50 A38 38 0 1 0 50 88 H66" fill="none" stroke="#fff" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="84" cy="79" r="7" fill="#fff" />
    </svg>
  )
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function AuthShell({ children }: { children: ReactNode }) {
  const settings = useSettings()
  const online = useOnline()
  return (
    <div className="login-easy flex h-full min-h-0 flex-col items-center overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10 text-white">
      <main className="login-enter my-auto w-full max-w-[340px]">
        <OptimasMark />
        <h1 className="login-title mt-3 text-center text-[56px] leading-none text-white sm:text-[72px]">Optimas</h1>
        <div className="mt-10">{children}</div>
      </main>
      <footer className="mt-10 flex items-center gap-2 text-[12px] font-light text-white/75">
        <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-white' : 'bg-amber-300'}`} aria-hidden="true" />
        <span>{online ? 'Online' : 'Offline — you can still sign in'}</span>
        <span aria-hidden="true">·</span>
        <span className="max-w-[12rem] truncate">{settings.shopName}</span>
        <span aria-hidden="true">·</span>
        <span>v{APP_VERSION}</span>
      </footer>
    </div>
  )
}

function Notice({ children, tone = 'error', shake }: { children: ReactNode; tone?: 'error' | 'info'; shake?: number }) {
  return (
    <p
      key={shake}
      role={tone === 'error' ? 'alert' : 'status'}
      className={`login-notice mt-3 rounded-[3px] px-3 py-2 text-center text-[13px] leading-snug ${tone === 'error' ? 'login-shake bg-[#076f44] text-white' : 'bg-white/15 text-white'}`}
    >
      {children}
    </p>
  )
}

const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Find the staff member a typed username means: the full name in any case or
 * spacing ("optimas admin"), or any word of it when that picks one person
 * ("admin", "cashier").
 */
export function matchStaff<T extends { name: string }>(staff: T[], typed: string): T | undefined {
  const t = norm(typed)
  if (!t) return undefined
  const exact = staff.find((s) => norm(s.name) === t)
  if (exact) return exact
  const partial = staff.filter((s) => norm(s.name).split(' ').some((w) => w.startsWith(t)) || norm(s.name).startsWith(t))
  return partial.length === 1 ? partial[0] : undefined
}

// ----------------------------------------------------------------- sign in

function SignIn({ staff, source }: { staff: Staff[]; source: 'local' | 'server' }) {
  const { login, adopt } = useSession()
  const [username, setUsername] = useState(() => {
    try {
      const last = localStorage.getItem(LAST_USER_KEY)
      return last && staff.some((s) => s.name === last) ? last : staff.length === 1 ? staff[0].name : ''
    } catch {
      return ''
    }
  })
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [help, setHelp] = useState(false)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const userRef = useRef<HTMLInputElement>(null)
  const pinRef = useRef<HTMLInputElement>(null)

  const person = useMemo(() => matchStaff(staff, username), [staff, username])
  const suggestions = useMemo(() => {
    const t = norm(username)
    if (!t || person?.name === username) return staff
    return staff.filter((s) => norm(s.name).includes(t))
  }, [staff, username, person])
  const lockLeft = Math.max(0, lockedUntil - now)

  useEffect(() => {
    ;(username ? pinRef : userRef).current?.focus()
    // Focus once on arrival only.
  }, [])

  useEffect(() => {
    if (!lockedUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [lockedUntil])

  // Show an existing lockout for the chosen account.
  useEffect(() => {
    setLockedUntil(0)
    if (source !== 'local' || !person) return
    void lockRemaining(person.id).then((ms) => {
      if (ms > 0) {
        setNow(Date.now())
        setLockedUntil(Date.now() + ms)
      }
    })
  }, [person, source])

  const fail = (msg: string) => {
    setError(msg)
    setShake((n) => n + 1)
  }

  const choose = (s: Staff) => {
    setUsername(s.name)
    setOpen(false)
    setError('')
    pinRef.current?.focus()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    if (!person) {
      fail(username.trim() ? `No staff member called "${username.trim()}". Try ${staff.map((s) => s.name).join(' or ')}.` : 'Enter your name, e.g. Optimas Admin')
      return userRef.current?.focus()
    }
    if (person.name !== username) setUsername(person.name)
    if (pin.length < PIN_MIN) {
      fail(`Enter your ${PIN_MIN}–${PIN_MAX} digit PIN`)
      return pinRef.current?.focus()
    }
    if (lockLeft > 0) return
    setBusy(true)
    try {
      if (source === 'local') {
        const r = await login(person.id, pin)
        if (!r.ok) {
          fail(r.error)
          setPin('')
          if (r.lockedMs) {
            setNow(Date.now())
            setLockedUntil(Date.now() + r.lockedMs)
          }
          pinRef.current?.focus()
          return
        }
      } else {
        const u = await signInFromServer(person.id, pin)
        await adopt(u, pin)
      }
      try {
        localStorage.setItem(LAST_USER_KEY, person.name)
      } catch {
        /* not remembered */
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Sign-in failed')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const onUserKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setHi((h) => (suggestions.length ? (h + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && suggestions[hi]) choose(suggestions[hi])
      else if (person) choose(person)
      else void submit(e)
    } else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Sign in">
      <div className="relative">
        <label className="sr-only" htmlFor="login-user">
          Username
        </label>
        <input
          id="login-user"
          ref={userRef}
          className="login-input pr-10"
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="words"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls="login-staff"
          aria-autocomplete="list"
          value={username}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onUserKey}
          onChange={(e) => {
            setUsername(e.target.value)
            setOpen(true)
            setHi(0)
            setError('')
          }}
        />
        {person && (
          <Check size={17} strokeWidth={2.5} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#0cc77a]" aria-label="Staff member found" />
        )}
        {open && suggestions.length > 0 && (
          <ul id="login-staff" role="listbox" className="login-menu absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-[2px] bg-white py-1 text-left">
            {suggestions.map((s, i) => (
              <li key={s.id} role="option" aria-selected={i === hi}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => choose(s)}
                  className={`flex w-full items-center justify-between px-3.5 py-2.5 text-[15px] font-light text-[#1f2a24] ${i === hi ? 'bg-[#e8f8f0]' : ''}`}
                >
                  <span>{s.name}</span>
                  <span className="text-[11px] font-normal uppercase tracking-wider text-[#6f8f80]">{ROLE_LABEL[s.role]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative mt-3">
        <label className="sr-only" htmlFor="login-pin">
          PIN
        </label>
        <input
          id="login-pin"
          ref={pinRef}
          className={`login-input pr-11 ${pin && !showPin ? 'tracking-[0.35em]' : ''}`}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="PIN"
          maxLength={PIN_MAX}
          value={pin}
          disabled={lockLeft > 0}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))
            setError('')
          }}
        />
        <button
          type="button"
          onClick={() => {
            setShowPin((v) => !v)
            pinRef.current?.focus()
          }}
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-[#8a9690] transition hover:text-[#1f2a24]"
          aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
          aria-pressed={showPin}
        >
          {showPin ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>

      <div aria-live="polite">
        {lockLeft > 0 ? (
          <Notice>Too many wrong PINs for {person?.name}. Try again in {formatWait(lockLeft)}.</Notice>
        ) : error ? (
          <Notice shake={shake}>{error}</Notice>
        ) : null}
      </div>

      <button type="submit" disabled={busy || lockLeft > 0} className="login-button mt-10" aria-busy={busy}>
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 size={17} className="animate-spin" /> Signing in…
          </span>
        ) : (
          'Sign In'
        )}
      </button>

      <div className="mt-7 flex items-center justify-between text-[16px] font-light">
        <button type="button" className="login-link" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
          Forgot PIN?
        </button>
        <button
          type="button"
          className="login-link"
          onClick={() => {
            setOpen(true)
            setHi(0)
            userRef.current?.focus()
          }}
        >
          Staff list
        </button>
      </div>
      {help && <Notice tone="info">Ask the Optimas Admin to reset your PIN under Staff. After 5 wrong tries the account pauses briefly.</Notice>}
    </form>
  )
}

// ----------------------------------------------------------------- first-run setup

function SetupOwner() {
  const { adopt } = useSession()
  const settings = useSettings()
  const [shop, setShop] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => setShop((s) => s || settings.shopName), [settings.shopName])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const weak = weakPinReason(pin)
    if (!shop.trim()) return setError('Enter the shop name printed on receipts')
    if (!name.trim()) return setError('Enter your name')
    if (weak) return setError(weak)
    if (pin !== confirmPin) return setError('The two PINs do not match')
    setBusy(true)
    try {
      await saveSettings({ shopName: shop.trim() })
      const id = await createOwner(name, pin)
      await adopt((await db.users.get(id))!, pin)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX)

  return (
    <form onSubmit={submit} noValidate>
      <p className="mb-4 text-center text-[15px] font-light">Create the owner account to open this till.</p>
      <input className="login-input" placeholder="Shop name" value={shop} onChange={(e) => setShop(e.target.value)} autoComplete="organization" />
      <input className="login-input mt-3" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
      <input className="login-input mt-3" type="password" inputMode="numeric" placeholder={`Owner PIN (${PIN_MIN}–${PIN_MAX} digits)`} value={pin} onChange={(e) => setPin(digits(e.target.value))} autoComplete="new-password" />
      <input className="login-input mt-3" type="password" inputMode="numeric" placeholder="Repeat PIN" value={confirmPin} onChange={(e) => setConfirmPin(digits(e.target.value))} autoComplete="new-password" />
      {error && <Notice>{error}</Notice>}
      <button type="submit" disabled={busy} className="login-button mt-11">
        {busy ? <Loader2 size={18} className="mx-auto animate-spin" /> : 'Create owner & sign in'}
      </button>
    </form>
  )
}

// ----------------------------------------------------------------- forced PIN change

/** Shown after sign-in when the PIN was set by someone else or is too weak. */
export function PinChangeGate({ user }: { user: User }) {
  const { lock } = useSession()
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!verifyPin(current, user.pinHash)) return setError('Current PIN is wrong')
    const weak = weakPinReason(pin)
    if (weak) return setError(weak)
    if (pin === current) return setError('Choose a PIN different from the current one')
    if (pin !== confirmPin) return setError('The two PINs do not match')
    setBusy(true)
    const pinHash = hashPin(pin)
    await db.users.update(user.id!, { pinHash, mustChangePin: undefined })
    await logActivity('user', `PIN changed for ${user.name}`, { userId: user.id, userName: user.name })
    void pushOwnPin(current, pinHash)
  }

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX)

  return (
    <AuthShell>
      <form onSubmit={submit} noValidate>
        <p className="mb-4 text-center text-[15px] font-light">{user.name}, choose a new private PIN before you continue.</p>
        <input className="login-input" type="password" inputMode="numeric" placeholder="Current PIN" value={current} autoFocus onChange={(e) => setCurrent(digits(e.target.value))} />
        <input className="login-input mt-3" type="password" inputMode="numeric" placeholder={`New PIN (${PIN_MIN}–${PIN_MAX} digits)`} value={pin} autoComplete="new-password" onChange={(e) => setPin(digits(e.target.value))} />
        <input className="login-input mt-3" type="password" inputMode="numeric" placeholder="Repeat new PIN" value={confirmPin} autoComplete="new-password" onChange={(e) => setConfirmPin(digits(e.target.value))} />
        {error && <Notice>{error}</Notice>}
        <button type="submit" disabled={busy} className="login-button mt-11">
          {busy ? <Loader2 size={18} className="mx-auto animate-spin" /> : 'Save PIN'}
        </button>
        <div className="mt-8 text-center text-[16px] font-light">
          <button type="button" className="login-link" onClick={lock}>
            Sign out
          </button>
        </div>
      </form>
    </AuthShell>
  )
}
