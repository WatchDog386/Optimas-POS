import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Loader2 } from 'lucide-react'
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
    <svg viewBox="0 0 100 100" className="mx-auto h-[120px] w-[120px] sm:h-[146px] sm:w-[146px]" aria-hidden="true">
      {/* Ring open at the lower right, its end running out into a short tail, then a dot. */}
      <path d="M88 50 A38 38 0 1 0 50 88 H66" fill="none" stroke="#fff" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="84" cy="79" r="7" fill="#fff" />
    </svg>
  )
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="login-easy flex h-full min-h-0 flex-col items-center overflow-y-auto bg-[#0cc77a] px-5 py-10 text-white">
      <div className="my-auto w-full max-w-[340px]">
        <OptimasMark />
        <h1 className="login-title mt-3 text-center text-[56px] leading-none text-white sm:text-[72px]">Optimas</h1>
        <div className="mt-11">{children}</div>
      </div>
    </div>
  )
}

function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) {
  return (
    <p role={tone === 'error' ? 'alert' : undefined} className={`mt-3 rounded-[3px] px-3 py-2 text-center text-[13px] ${tone === 'error' ? 'bg-[#076f44] text-white' : 'bg-white/15 text-white'}`}>
      {children}
    </p>
  )
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [help, setHelp] = useState(false)
  const [list, setList] = useState(false)
  const userRef = useRef<HTMLInputElement>(null)
  const pinRef = useRef<HTMLInputElement>(null)

  const person = useMemo(() => staff.find((s) => s.name.trim().toLowerCase() === username.trim().toLowerCase()), [staff, username])
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    if (!person) {
      setError(username.trim() ? `No staff member called "${username.trim()}"` : 'Enter your username')
      return userRef.current?.focus()
    }
    if (pin.length < PIN_MIN) {
      setError(`Enter your ${PIN_MIN}–${PIN_MAX} digit PIN`)
      return pinRef.current?.focus()
    }
    if (lockLeft > 0) return
    setBusy(true)
    try {
      if (source === 'local') {
        const r = await login(person.id, pin)
        if (!r.ok) {
          setError(r.error)
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
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="sr-only" htmlFor="login-user">
        Username
      </label>
      <input
        id="login-user"
        ref={userRef}
        className="login-input"
        placeholder="Username"
        autoComplete="username"
        list="login-staff"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value)
          setError('')
        }}
      />
      <datalist id="login-staff">
        {staff.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>

      <label className="sr-only" htmlFor="login-pin">
        PIN
      </label>
      <input
        id="login-pin"
        ref={pinRef}
        className="login-input mt-3 tracking-[0.35em] placeholder:tracking-normal"
        type="password"
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

      {lockLeft > 0 ? <Notice>Too many wrong PINs. Try again in {formatWait(lockLeft)}.</Notice> : error ? <Notice>{error}</Notice> : null}

      <button type="submit" disabled={busy || lockLeft > 0} className="login-button mt-11">
        {busy ? <Loader2 size={18} className="mx-auto animate-spin" /> : 'Sign In'}
      </button>

      <div className="mt-8 flex items-center justify-between text-[16px] font-light">
        <button type="button" className="login-link" onClick={() => setHelp((h) => !h)}>
          Forgot PIN?
        </button>
        <button type="button" className="login-link" onClick={() => setList((l) => !l)}>
          Staff list
        </button>
      </div>
      {help && <Notice tone="info">Ask the Optimas Admin to reset your PIN under Staff.</Notice>}
      {list && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {staff.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setUsername(s.name)
                setList(false)
                setError('')
                pinRef.current?.focus()
              }}
              className="rounded-[3px] bg-white/15 px-3 py-1.5 text-sm text-white transition hover:bg-white/25"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
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
