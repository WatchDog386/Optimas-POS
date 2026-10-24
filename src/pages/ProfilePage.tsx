import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, History, MonitorSpeaker, Power, ShieldCheck, UserRound } from 'lucide-react'
import { db } from '../db/db'
import { useSession } from '../session'
import type { LogEntry, User } from '../db/types'
import { Badge, PageHeader, errorText, useToast } from '../components/ui'
import ChangePinForm from '../components/ChangePinForm'
import { useInstall } from '../lib/installPrompt'

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
  const appInstall = useInstall()

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

  // Downloads a .bat that opens the till in app mode and copies itself into
  // Windows' Startup folder, so the POS boots with the computer.
  const downloadStartupScript = () => {
    const url = window.location.origin
    const bat = [
      '@echo off',
      'rem Optimas POS — launches the till in app mode and installs itself to run at Windows startup.',
      'set "LINK=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Start Optimas POS.bat"',
      'if not exist "%LINK%" copy "%~f0" "%LINK%"',
      `start "" msedge.exe --app=${url}`,
    ].join('\r\n')
    const blob = new Blob([bat], { type: 'application/bat' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'Start Optimas POS.bat'
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Startup script saved — run it once and the till will boot with this computer')
  }

  // Profile photo: crop to a square and downscale so IndexedDB stays small.
  const uploadPhoto = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = async () => {
        try {
          const size = 256
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas is not available in this browser')
          const scale = Math.max(size / img.width, size / img.height)
          const w = img.width * scale
          const h = img.height * scale
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
          const image = canvas.toDataURL('image/jpeg', 0.85)
          await db.users.update(user.id!, { image })
          toast('Profile photo updated')
        } catch (e) {
          toast(errorText(e), 'error')
        }
      }
      img.onerror = () => toast('That file is not a readable image', 'error')
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const removePhoto = async () => {
    try {
      await db.users.update(user.id!, { image: undefined })
      toast('Profile photo removed')
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
                src={user.image ?? 'avatar.svg'}
                alt={user.name}
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

          {!appInstall.installed && appInstall.canInstall && (
            <button
              onClick={appInstall.install}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-raised active:scale-[0.99]"
            >
              <Download size={15} />
              Install app
            </button>
          )}
          {!appInstall.installed && !appInstall.canInstall && appInstall.isIOS && (
            <p className="mt-4 px-1 text-xs leading-relaxed text-slate-400">
              On iPhone: tap <b className="text-slate-500">Share</b> → <b className="text-slate-500">Add to Home Screen</b> to install the app.
            </p>
          )}
          {appInstall.installed && (
            <p className="mt-4 flex items-center gap-1.5 px-1 text-xs text-slate-400">
              <Badge tone="green">Installed</Badge>
              on this device
            </p>
          )}

          <p className="mt-4 hidden px-1 text-xs leading-relaxed text-slate-400 md:block">
            Signed in with your {user.pin.length}-digit PIN. Profile details stay on this device.
          </p>
        </nav>

        {/* Right content */}
        <div className="min-w-0 p-6">
          {section === 'personal' && (
            <>
            <h2 className="text-sm font-bold text-slate-900 sm:text-xl">Personal information</h2>

            <div className="mt-4 flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 ring-2 ring-white">
                {user.image ? (
                  <img src={user.image} alt={user.name} className="h-full w-full object-cover" />
                ) : (
                  <UserRound size={26} className="text-slate-400" />
                )}
              </span>
              <div className="flex flex-col items-start gap-1.5">
                <label className="btn-ghost cursor-pointer px-3 py-1.5 text-sm">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadPhoto(file)
                      e.target.value = ''
                    }}
                  />
                  Upload photo
                </label>
                {user.image && (
                  <button className="text-xs font-medium text-red-600 transition hover:underline" onClick={() => void removePhoto()}>
                    Remove photo
                  </button>
                )}
                <p className="text-[11px] text-slate-400">Shown next to your name on the till header.</p>
              </div>
            </div>

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

              <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-slate-600">Terminal setup</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <Download size={16} className="text-brand-600" /> Install on this desktop
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Installs the till as a desktop app with its own window and Start-menu entry.
                  </p>
                  <button
                    className="btn-primary mt-3 w-full"
                    disabled={!appInstall.canInstall || appInstall.installed}
                    onClick={appInstall.install}
                  >
                    {appInstall.installed ? 'Installed' : appInstall.canInstall ? 'Install app' : 'Already available'}
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <MonitorSpeaker size={16} className="text-brand-600" /> Start with the computer
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Downloads a startup script. Run it once — it launches the till at every boot, no browser bars.
                  </p>
                  <button className="btn-ghost mt-3 w-full" onClick={downloadStartupScript}>
                    <Power size={15} /> Download startup script
                  </button>
                </div>
              </div>
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
