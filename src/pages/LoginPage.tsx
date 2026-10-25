import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Check, CloudOff, Delete, KeyRound, Loader2, Lock, ShieldCheck, Store, Wifi } from 'lucide-react'
import { db } from '../db/db'
import { saveSettings, useSettings } from '../db/settings'
import { createOwner, needsSetup } from '../db/seed'
import { logActivity } from '../db/logs'
import { hashPin, verifyPin, weakPinReason } from '../lib/pinHash'
import { pushOwnPin, serverStaff, signInFromServer } from '../lib/api'
import { PIN_MAX, PIN_MIN, formatWait, lockRemaining, useSession } from '../session'
import type { Role, User } from '../db/types'

type StaffCard = { id: number; name: string; role: Role; image?: string; lastLoginAt?: number }
type Mode = { kind: 'loading' } | { kind: 'local' } | { kind: 'server'; staff: StaffCard[] } | { kind: 'setup' }

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier' }
const ROLE_TONE: Record<Role, string> = {
  owner: 'bg-amber-400/15 text-amber-300 ring-amber-300/30',
  manager: 'bg-sky-400/15 text-sky-300 ring-sky-300/30',
  cashier: 'bg-emerald-400/15 text-emerald-300 ring-emerald-300/30',
}
const AVATAR_TONES = ['from-sky-500 to-blue-700', 'from-emerald-500 to-teal-700', 'from-amber-500 to-orange-700', 'from-fuchsia-500 to-purple-700', 'from-rose-500 to-red-700']

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

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

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

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
      {mode.kind === 'loading' && (
        <div className="grid place-items-center py-24 text-slate-400">
          <Loader2 className="animate-spin" size={28} />
        </div>
      )}
      {mode.kind === 'local' && (
        <SignIn
          staff={(localUsers ?? []).filter((u) => u.active).map((u) => ({ id: u.id!, name: u.name, role: u.role, image: u.image, lastLoginAt: u.lastLoginAt }))}
          source="local"
        />
      )}
      {mode.kind === 'server' && <SignIn staff={mode.staff} source="server" />}
      {mode.kind === 'setup' && <SetupOwner />}
    </AuthShell>
  )
}

// ----------------------------------------------------------------- layout

function AuthShell({ children }: { children: ReactNode }) {
  const settings = useSettings()
  const online = useOnline()
  const now = useClock()

  return (
    <div className="auth-shell flex h-full min-h-0 bg-[#060d1f] text-white">
      {/* Brand panel */}
      <aside className="auth-brand relative hidden w-[46%] max-w-[720px] shrink-0 flex-col overflow-hidden lg:flex">
        <div className="relative z-10 flex items-center gap-3 p-10">
          <img src="/icon.svg" alt="" className="h-11 w-11 rounded-xl shadow-lg shadow-black/30" />
          <div>
            <div className="text-lg font-bold leading-tight tracking-tight">{settings.shopName}</div>
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-sky-200/70">Spare parts point of sale</div>
          </div>
        </div>

        <div className="relative z-10 px-10">
          <div className="font-mono text-6xl font-semibold tabular-nums tracking-tight">
            {now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="mt-2 text-base text-sky-100/70">
            {now.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>

        <img src="/login.png" alt="" className="auth-hero pointer-events-none absolute bottom-0 right-[-6%] z-0 h-[78%] w-auto max-w-none select-none object-contain" draggable={false} />

        <div className="relative z-10 mt-auto grid max-w-sm gap-2.5 p-10 text-sm text-sky-50/85">
          {[
            [ShieldCheck, 'PINs are hashed and never stored in plain text'],
            [Lock, 'Locks after idle time and repeated wrong PINs'],
            [CloudOff, 'Keeps selling through internet and power cuts'],
          ].map(([Icon, text]) => {
            const I = Icon as typeof ShieldCheck
            return (
              <div key={text as string} className="flex items-center gap-2.5 rounded-lg bg-white/[0.06] px-3 py-2 ring-1 ring-white/10 backdrop-blur">
                <I size={15} className="shrink-0 text-emerald-300" />
                {text as string}
              </div>
            )
          })}
        </div>
      </aside>

      {/* Auth panel */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2.5 lg:invisible">
            <img src="/icon.svg" alt="" className="h-9 w-9 rounded-lg" />
            <span className="truncate text-base font-bold">{settings.shopName}</span>
          </div>
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${online ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-300/25' : 'bg-amber-400/10 text-amber-300 ring-amber-300/25'}`}>
            {online ? <Wifi size={13} /> : <CloudOff size={13} />}
            {online ? 'Online' : 'Offline mode'}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-10 sm:px-8">
          <div className="w-full max-w-[520px]">{children}</div>
        </div>
        <p className="px-5 pb-5 text-center text-[11px] text-slate-500">Every sign-in, sale and change is recorded in the activity log.</p>
      </main>
    </div>
  )
}

// ----------------------------------------------------------------- sign in

function SignIn({ staff, source }: { staff: StaffCard[]; source: 'local' | 'server' }) {
  const [picked, setPicked] = useState<StaffCard | null>(staff.length === 1 ? staff[0] : null)
  const sorted = useMemo(() => {
    const rank: Record<Role, number> = { owner: 0, manager: 1, cashier: 2 }
    return [...staff].sort((a, b) => (b.lastLoginAt ?? 0) - (a.lastLoginAt ?? 0) || rank[a.role] - rank[b.role] || a.name.localeCompare(b.name))
  }, [staff])

  if (picked) return <PinStep person={picked} source={source} onBack={staff.length > 1 ? () => setPicked(null) : undefined} />

  return (
    <div className="auth-rise">
      <h1 className="text-3xl font-bold tracking-tight text-white">Who's signing in?</h1>
      <p className="mt-1.5 text-sm text-slate-400">
        {source === 'server' ? 'New till — sign in with your shop account to load staff onto this device.' : 'Tap your name, then enter your PIN.'}
      </p>
      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {sorted.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setPicked(s)}
            className="group flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-5 text-center ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-white/[0.08] hover:ring-sky-400/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 active:scale-[0.98]"
          >
            <Avatar name={s.name} image={s.image} tone={i} size="lg" />
            <span className="w-full">
              <span className="block truncate text-sm font-semibold">{s.name}</span>
              <span className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${ROLE_TONE[s.role]}`}>{ROLE_LABEL[s.role]}</span>
            </span>
          </button>
        ))}
      </div>
      {staff.length === 0 && <p className="mt-6 rounded-xl bg-white/5 p-4 text-sm text-slate-300">No active staff accounts. Ask the owner to reactivate yours.</p>}
    </div>
  )
}

function Avatar({ name, image, tone, size }: { name: string; image?: string; tone: number; size: 'lg' | 'md' }) {
  const dim = size === 'lg' ? 'h-16 w-16 text-xl' : 'h-12 w-12 text-base'
  return image ? (
    <img src={image} alt="" className={`${dim} rounded-full object-cover ring-2 ring-white/20`} />
  ) : (
    <span className={`${dim} grid place-items-center rounded-full bg-gradient-to-br ${AVATAR_TONES[tone % AVATAR_TONES.length]} font-bold text-white shadow-lg shadow-black/30 ring-2 ring-white/15`}>
      {initials(name)}
    </span>
  )
}

function PinStep({ person, source, onBack }: { person: StaffCard; source: 'local' | 'server'; onBack?: () => void }) {
  const { login, adopt } = useSession()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lockedUntil, setLockedUntil] = useState(0)
  const [shake, setShake] = useState(false)
  const now = useClock()
  const lockLeft = Math.max(0, lockedUntil - now.getTime())

  useEffect(() => {
    if (source !== 'local') return
    void lockRemaining(person.id).then((ms) => ms > 0 && setLockedUntil(Date.now() + ms))
  }, [person.id, source])

  const fail = (msg: string, lockedMs?: number) => {
    setError(msg)
    setPin('')
    setShake(true)
    setTimeout(() => setShake(false), 450)
    if (lockedMs) setLockedUntil(Date.now() + lockedMs)
  }

  const submit = useCallback(async () => {
    if (busy || pin.length < PIN_MIN || lockLeft > 0) return
    setBusy(true)
    setError('')
    try {
      if (source === 'local') {
        const r = await login(person.id, pin)
        if (!r.ok) fail(r.error, r.lockedMs)
      } else {
        const u = await signInFromServer(person.id, pin)
        await adopt(u, pin)
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }, [busy, pin, lockLeft, source, login, adopt, person.id])

  const press = useCallback(
    (k: string) => {
      setError('')
      if (k === 'back') setPin((p) => p.slice(0, -1))
      else if (k === 'clear') setPin('')
      else setPin((p) => (p.length >= PIN_MAX ? p : p + k))
    },
    [],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('back')
      else if (e.key === 'Escape') onBack ? onBack() : press('clear')
      else if (e.key === 'Enter') {
        e.preventDefault()
        void submit()
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, submit, onBack])

  const locked = lockLeft > 0

  return (
    <div className="auth-rise mx-auto max-w-[360px]">
      {onBack && (
        <button type="button" onClick={onBack} className="mb-6 flex items-center gap-1.5 text-sm font-medium text-slate-400 transition hover:text-white">
          <ArrowLeft size={16} /> Switch user
        </button>
      )}
      <div className="flex flex-col items-center text-center">
        <Avatar name={person.name} image={person.image} tone={person.id} size="lg" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">Hi, {person.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-slate-400">{locked ? 'Account temporarily locked' : 'Enter your PIN to unlock the till'}</p>
      </div>

      <div className={`mt-7 flex justify-center gap-3 ${shake ? 'auth-shake' : ''}`} aria-live="polite" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(PIN_MIN, Math.min(PIN_MAX, pin.length + (pin.length < PIN_MAX ? 1 : 0))) }, (_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full transition-all duration-150 ${i < pin.length ? 'scale-110 bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.6)]' : 'bg-white/15'}`}
          />
        ))}
      </div>

      <div className="mt-4 min-h-[22px] text-center text-sm font-medium">
        {locked ? (
          <span className="text-amber-300">Try again in {formatWait(lockLeft)}</span>
        ) : error ? (
          <span className="text-rose-400">{error}</span>
        ) : busy ? (
          <span className="inline-flex items-center gap-2 text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Checking…
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <PadKey key={k} onClick={() => press(k)} disabled={locked || busy}>
            {k}
          </PadKey>
        ))}
        <PadKey onClick={() => press('back')} disabled={locked || busy || !pin} label="Delete last digit" muted>
          <Delete size={20} />
        </PadKey>
        <PadKey onClick={() => press('0')} disabled={locked || busy}>
          0
        </PadKey>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={locked || busy || pin.length < PIN_MIN}
          aria-label="Unlock"
          className="grid h-16 place-items-center rounded-2xl bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-[0_10px_24px_-10px_rgba(16,185,129,0.8)] transition hover:brightness-110 active:scale-[0.97] disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 disabled:shadow-none"
        >
          {busy ? <Loader2 size={22} className="animate-spin" /> : <Check size={24} strokeWidth={2.5} />}
        </button>
      </div>
      <p className="mt-6 text-center text-xs text-slate-500">Forgot your PIN? Ask the owner to reset it under Staff.</p>
    </div>
  )
}

function PadKey({ children, onClick, disabled, label, muted }: { children: ReactNode; onClick: () => void; disabled?: boolean; label?: string; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`grid h-16 place-items-center rounded-2xl text-2xl font-semibold ring-1 ring-white/10 transition active:scale-[0.97] disabled:opacity-35 ${
        muted ? 'bg-transparent text-slate-300 hover:bg-white/[0.06]' : 'bg-white/[0.06] text-white hover:bg-white/[0.12]'
      }`}
    >
      {children}
    </button>
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

  const submit = async (e: React.FormEvent) => {
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

  return (
    <form onSubmit={submit} className="auth-rise">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-300/25">
        <Store size={22} />
      </span>
      <h1 className="mt-5 text-3xl font-bold tracking-tight text-white">Set up your till</h1>
      <p className="mt-1.5 text-sm text-slate-400">Create the owner account. You'll add cashiers and managers from Staff once you're in.</p>

      <div className="mt-7 space-y-4">
        <AuthField label="Shop name" hint="Printed on receipts and labels">
          <input className="auth-input" value={shop} onChange={(e) => setShop(e.target.value)} autoComplete="organization" />
        </AuthField>
        <AuthField label="Your name">
          <input className="auth-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
        </AuthField>
        <div className="grid gap-4 sm:grid-cols-2">
          <AuthField label={`Owner PIN (${PIN_MIN}–${PIN_MAX} digits)`}>
            <input
              className="auth-input font-mono tracking-[0.4em]"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={PIN_MAX}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </AuthField>
          <AuthField label="Repeat PIN">
            <input
              className="auth-input font-mono tracking-[0.4em]"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={PIN_MAX}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            />
          </AuthField>
        </div>
        <p className="flex items-start gap-2 text-xs text-slate-400">
          <KeyRound size={14} className="mt-0.5 shrink-0 text-sky-300" />
          Avoid repeated digits, sequences like 1234, birthdays and phone numbers. A 6-digit PIN is much harder to guess.
        </p>
      </div>

      {error && <p className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-300 ring-1 ring-rose-400/25">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-sky-500 to-blue-600 text-sm font-bold uppercase tracking-wider text-white shadow-[0_12px_28px_-12px_rgba(37,99,235,0.9)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />} Create owner & open till
      </button>
    </form>
  )
}

function AuthField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
        {hint && <span className="font-normal normal-case tracking-normal text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
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

  const submit = async (e: React.FormEvent) => {
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

  return (
    <AuthShell>
      <form onSubmit={submit} className="auth-rise">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-300/25">
          <KeyRound size={22} />
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-white">Choose a new PIN</h1>
        <p className="mt-1.5 text-sm text-slate-400">
          {user.name}, your PIN was set by someone else or is too easy to guess. Pick a private one before you continue.
        </p>
        <div className="mt-7 space-y-4">
          <AuthField label="Current PIN">
            <input className="auth-input font-mono tracking-[0.4em]" type="password" inputMode="numeric" maxLength={PIN_MAX} value={current} autoFocus onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))} />
          </AuthField>
          <div className="grid gap-4 sm:grid-cols-2">
            <AuthField label={`New PIN (${PIN_MIN}–${PIN_MAX} digits)`}>
              <input className="auth-input font-mono tracking-[0.4em]" type="password" inputMode="numeric" maxLength={PIN_MAX} value={pin} autoComplete="new-password" onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </AuthField>
            <AuthField label="Repeat new PIN">
              <input className="auth-input font-mono tracking-[0.4em]" type="password" inputMode="numeric" maxLength={PIN_MAX} value={confirmPin} autoComplete="new-password" onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} />
            </AuthField>
          </div>
        </div>
        {error && <p className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-300 ring-1 ring-rose-400/25">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={lock} className="h-12 rounded-xl px-5 text-sm font-semibold text-slate-300 ring-1 ring-white/15 transition hover:bg-white/5">
            Sign out
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-sky-500 to-blue-600 text-sm font-bold uppercase tracking-wider text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Save PIN
          </button>
        </div>
      </form>
    </AuthShell>
  )
}
