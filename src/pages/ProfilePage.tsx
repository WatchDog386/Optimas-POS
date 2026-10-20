import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { History, ShieldCheck, UserRound } from 'lucide-react'
import { db } from '../db/db'
import { useSession } from '../session'
import type { LogEntry, User } from '../db/types'
import { Badge, PageHeader, errorText, useToast } from '../components/ui'
import ChangePinForm from '../components/ChangePinForm'

type SectionId = 'personal' | 'security' | 'activity'

const SECTIONS: { id: SectionId; label: string; icon: typeof UserRound; iconClass: string }[] = [
  { id: 'personal', label: 'Personal information', icon: UserRound, iconClass: 'bg-sky-100 text-sky-600' },
  { id: 'security', label: 'Security', icon: ShieldCheck, iconClass: 'bg-amber-100 text-amber-600' },
  { id: 'activity', label: 'My activity', icon: History, iconClass: 'bg-violet-100 text-violet-600' },
]

const LOG_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  auth: 'blue',
  sale: 'green',
  stock: 'amber',
  shift: 'slate',
  settings: 'slate',
  user: 'slate',
  system: 'red',
}

const LOG_LABEL: Record<string, string> = {
  auth: 'Sign-in',
  sale: 'Sale',
  stock: 'Stock',
  shift: 'Shift',
  settings: 'Settings',
  user: 'Staff',
  system: 'System',
}

interface Draft {
  first: string
  last: string
  email: string
  phone: string
  about: string
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

function toDraft(u: User): Draft {
  const { first, last } = splitName(u.name)
  return { first, last, email: u.email ?? '', phone: u.phone ?? '', about: u.about ?? '' }
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export default function ProfilePage() {
  const { user } = useSession()
  const toast = useToast()
  const [section, setSection] = useState<SectionId>('personal')
  const [draft, setDraft] = useState<Draft | null>(user ? toDraft(user) : null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (user) {
      setDraft(toDraft(user))
      setDirty(false)
    }
  }, [user])

  const logs = useLiveQuery(
    () =>
      user
        ? db.logs
            .orderBy('at')
            .reverse()
            .filter((l) => l.userId === user.id)
            .limit(30)
            .toArray()
        : Promise.resolve<LogEntry[]>([]),
    [user?.id],
    [] as LogEntry[],
  )

  const initials = useMemo(() => (user ? splitName(user.name).first.slice(0, 1).toUpperCase() : '?'), [user])

  if (!user || !draft) return null

  const set = (k: keyof Draft, v: string) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d))
    setDirty(true)
  }

  const cancel = () => {
    setDraft(toDraft(user))
    setDirty(false)
  }

  const save = async () => {
    try {
      const first = draft.first.trim()
      if (!first) throw new Error('First name is required')
      const name = [first, draft.last.trim()].filter(Boolean).join(' ')
      await db.users.update(user.id!, {
        name,
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        about: draft.about.trim() || undefined,
      })
      toast('Profile updated')
      setDirty(false)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Profile" subtitle="Your account on this till — what shows on receipts and the activity log" />

      <div className="card grid max-w-5xl overflow-hidden md:grid-cols-[250px_1fr]">
        {/* Left section nav */}
        <nav className="border-b border-slate-100 bg-slate-50/70 p-4 md:border-b-0 md:border-r">
          <div className="mb-4 flex items-center gap-3 px-1">
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-500 text-lg font-bold text-white shadow ring-4 ring-white">
              <span>{initials}</span>
              <img
                src="avatar.svg"
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900">{user.name}</div>
              <div className="flex items-center gap-1.5 text-xs capitalize text-slate-500">
                {user.role}
                <Badge tone={user.active ? 'green' : 'red'}>{user.active ? 'Active' : 'Disabled'}</Badge>
              </div>
            </div>
          </div>

          <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Menu</div>
          <div className="space-y-1">
            {SECTIONS.map(({ id, label, icon: Icon, iconClass }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${
                  section === id ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${section === id ? 'bg-white/20 text-white' : iconClass}`}>
                  <Icon size={14} />
                </span>
                {label}
              </button>
            ))}
          </div>

          <p className="mt-4 hidden px-1 text-xs leading-relaxed text-slate-400 md:block">
            Signed in with your {user.pin.length}-digit PIN. Profile details stay on this device.
          </p>
        </nav>

        {/* Right content */}
        <div className="min-w-0 p-6">
          {section === 'personal' && (
            <>
              <h2 className="text-sm font-bold text-slate-900 sm:text-xl">Personal information</h2>

              <h3 className="mt-5 text-sm font-bold text-slate-800">Profile</h3>
              <p className="mt-0.5 text-xs text-slate-500">This name is printed on receipts you handle and shown in the activity log.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="First name">
                  <input className="input" value={draft.first} onChange={(e) => set('first', e.target.value)} />
                </Field>
                <Field label="Last name">
                  <input className="input" value={draft.last} onChange={(e) => set('last', e.target.value)} />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Email">
                  <input className="input" type="email" placeholder="you@example.com" value={draft.email} onChange={(e) => set('email', e.target.value)} />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="About" hint="Brief note for your profile — shift you usually work, skills, etc.">
                  <textarea className="input" rows={3} value={draft.about} onChange={(e) => set('about', e.target.value)} />
                </Field>
              </div>

              <h3 className="mt-6 text-sm font-bold text-slate-800">Account details</h3>
              <p className="mt-0.5 text-xs text-slate-500">How the till identifies you. Role and status are set by the owner on the Staff page.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Phone number">
                  <input className="input" type="tel" placeholder="07xx xxx xxx" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
                </Field>
                <Field label="Role">
                  <input className="input capitalize text-slate-500" value={user.role} disabled readOnly />
                </Field>
                <Field label="PIN">
                  <div className="flex items-center gap-2">
                    <input className="input font-mono tracking-[0.4em]" value={'•'.repeat(user.pin.length)} disabled readOnly />
                    <button className="btn-ghost shrink-0" onClick={() => setSection('security')}>
                      Change
                    </button>
                  </div>
                </Field>
                <Field label="Status">
                  <input className="input" value={user.active ? 'Active' : 'Disabled'} disabled readOnly />
                </Field>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button className="btn-ghost" onClick={cancel} disabled={!dirty}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={save} disabled={!dirty}>
                  Save
                </button>
              </div>
            </>
          )}

          {section === 'security' && (
            <>
              <h2 className="text-sm font-bold text-slate-900 sm:text-xl">Security</h2>
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <ShieldCheck size={20} className="mt-0.5 shrink-0 text-brand-600" />
                <div className="text-sm text-slate-600">
                  Your PIN unlocks the till and signs every sale, refund and settings change against your name. Lock the till when you step away.
                </div>
              </div>
              <h3 className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-slate-600">Change my PIN</h3>
              <ChangePinForm />
            </>
          )}

          {section === 'activity' && (
            <>
              <h2 className="text-sm font-bold text-slate-900 sm:text-xl">My activity</h2>
              <p className="mt-1 text-sm text-slate-500">Your latest {logs.length} recorded events on this device.</p>
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                {logs.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">Nothing recorded yet — your sign-ins and sales will show up here.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {logs.map((l, i) => (
                      <li key={`${l.at}-${i}`} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-800">{l.action}</span>
                            <Badge tone={LOG_TONE[l.kind] ?? 'slate'}>{LOG_LABEL[l.kind] ?? l.kind}</Badge>
                          </div>
                          {l.detail && <div className="mt-0.5 truncate text-sm text-slate-500">{l.detail}</div>}
                        </div>
                        <div className="shrink-0 font-mono text-xs text-slate-400">
                          {new Date(l.at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
