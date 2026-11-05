import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Power, Search, ShieldCheck, UserRound, Users } from 'lucide-react'
import { db } from '../db/db'
import { logActivity } from '../db/logs'
import type { Role, User } from '../db/types'
import { PERMS, PIN_MAX, PIN_MIN, useSession, type Permission } from '../session'
import { hashPin, weakPinReason } from '../lib/pinHash'
import { pushUsers } from '../lib/api'
import { Modal, errorText, useToast } from '../components/ui'

const PERM_COLS: { key: Permission; label: string }[] = [
  { key: 'refund', label: 'Refunds' },
  { key: 'discount', label: 'Discounts' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'purchasing', label: 'Purchasing' },
  { key: 'reports', label: 'Reports' },
  { key: 'logs', label: 'Logs' },
  { key: 'users', label: 'Staff' },
  { key: 'settings', label: 'Settings' },
]

const ROLES: Role[] = ['owner', 'manager', 'cashier']

export default function StaffPage() {
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const { user: me } = useSession()
  const toast = useToast()
  const [edit, setEdit] = useState<Partial<User> | null>(null)
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')

  // Sales count (rolling 30 days) per user id.
  const salesByUser = useLiveQuery(
    async () => {
      const since = Date.now() - 30 * 86_400_000
      const sales = await db.sales.where('createdAt').above(since).toArray()
      const counts: Record<number, number> = {}
      for (const s of sales) {
        if (s.total > 0 && s.status !== 'voided' && s.userId) counts[s.userId] = (counts[s.userId] ?? 0) + 1
      }
      return counts
    },
    [],
    {} as Record<number, number>,
  )

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(q.trim().toLowerCase()) && (roleFilter === 'all' || u.role === roleFilter),
  )
  const active = users.filter((u) => u.active).length
  const cashiers = users.filter((u) => u.role === 'cashier').length
  const salesLast30Days = Object.values(salesByUser).reduce((sum, count) => sum + count, 0)

  const toggleActive = async (u: User) => {
    if (u.active && u.role === 'owner' && users.filter((x) => x.role === 'owner' && x.active && x.id !== u.id).length === 0) {
      return toast('Keep at least one active owner', 'error')
    }
    await db.users.update(u.id!, { active: !u.active })
    void pushUsers()
    await logActivity('user', `${u.name} ${u.active ? 'deactivated' : 'reactivated'}`, { userId: me?.id, userName: me?.name })
    toast(`${u.name} ${u.active ? 'deactivated' : 'reactivated'}`)
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-mc-navy text-white"><Users size={20} /></span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-mc-ink">Staff & access</h1>
              <span className="mc-pill bg-mc-cobalt-soft text-mc-cobalt-hover">Owner workspace</span>
            </div>
            <p className="mt-0.5 text-sm text-mc-muted">Manage till users, PIN access and cashier activity.</p>
          </div>
        </div>
        <button className="mc-btn-primary h-10 px-4" onClick={() => setEdit({ role: 'cashier', active: true })}>
          <Plus size={16} /> Add staff member
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Team overview">
        <StaffMetric label="Team members" value={users.length} detail="All till users" icon={<Users size={17} />} />
        <StaffMetric label="Active access" value={active} detail={`${users.length - active} disabled`} icon={<UserRound size={17} />} tone="green" />
        <StaffMetric label="Cashiers" value={cashiers} detail="Checkout access" icon={<Power size={17} />} tone="blue" />
        <StaffMetric label="Sales · 30 days" value={salesLast30Days.toLocaleString('en-KE')} detail="Completed tickets" icon={<ShieldCheck size={17} />} tone="amber" />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(300px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-mc-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mc-line px-4 py-3.5">
            <div>
              <h2 className="font-semibold text-mc-ink">Team directory</h2>
              <p className="mt-0.5 text-xs text-mc-muted">Select a staff member to edit their role or till PIN.</p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <label className="relative min-w-[180px] flex-1 sm:w-52 sm:flex-none">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mc-faint" />
                <input className="w-full rounded-lg border border-mc-line-strong bg-white py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-mc-faint focus:border-mc-cobalt focus:ring-2 focus:ring-mc-cobalt/20" placeholder="Search staff" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <select className="rounded-lg border border-mc-line-strong bg-white px-3 py-2 text-sm text-mc-body outline-none focus:border-mc-cobalt" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | 'all')} aria-label="Filter by role">
                <option value="all">All roles</option>
                {ROLES.map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead className="bg-mc-canvas text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-mc-muted">
                <tr>
                  <th className="px-4 py-3">Staff member</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Last sign-in</th>
                  <th className="px-3 py-3 text-right">Sales · 30d</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mc-line">
                {filtered.map((u) => (
                  <tr key={u.id} className="cursor-pointer transition hover:bg-mc-cobalt-soft/40" onClick={() => setEdit(u)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEdit(u) } }} tabIndex={0}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-mc-panel text-sm font-bold text-mc-navy">{u.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-mc-ink">{u.name} {u.id === me?.id && <span className="ml-1 text-xs font-normal text-mc-muted">You</span>}</div>
                          <div className="text-xs text-mc-muted">Till user · ID {u.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3"><RoleTag role={u.role} /></td>
                    <td className="px-3 py-3 text-xs text-mc-muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}{u.mustChangePin && <span className="ml-1.5 rounded bg-mc-warn-soft px-1.5 py-0.5 font-semibold text-amber-800">PIN reset pending</span>}</td>
                    <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-mc-body">{(salesByUser[u.id ?? -1] ?? 0).toLocaleString('en-KE')}</td>
                    <td className="px-3 py-3"><span className={`mc-pill ${u.active ? 'bg-mc-ok-soft text-green-800' : 'bg-slate-100 text-slate-500'}`}><span className={`h-1.5 w-1.5 rounded-full ${u.active ? 'bg-mc-ok' : 'bg-slate-400'}`} />{u.active ? 'Active' : 'Disabled'}</span></td>
                    <td className="px-4 py-3 text-right">
                      <button className="rounded-lg border border-mc-line-strong bg-white px-2.5 py-1.5 text-xs font-semibold text-mc-body transition hover:border-mc-cobalt hover:text-mc-cobalt-hover" onClick={(e) => { e.stopPropagation(); void toggleActive(u) }}>
                        {u.active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-mc-muted">No staff match this search and role filter.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-mc-line bg-mc-canvas/60 px-4 py-2.5 text-xs text-mc-muted">
            <span>{filtered.length} of {users.length} staff shown</span>
            <span>Last 30 days · completed tickets</span>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-mc-line bg-white">
          <div className="border-b border-mc-line px-4 py-3.5">
            <h2 className="font-semibold text-mc-ink">Role permissions</h2>
            <p className="mt-0.5 text-xs text-mc-muted">Access follows each user’s assigned role.</p>
          </div>
          <div className="divide-y divide-mc-line">
            {ROLES.map((role) => (
              <div key={role} className="px-4 py-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <RoleTag role={role} />
                  <span className="text-xs tabular-nums text-mc-muted">{users.filter((u) => u.role === role).length} {users.filter((u) => u.role === role).length === 1 ? 'member' : 'members'}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PERM_COLS.map(({ key, label }) => <span key={key} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${PERMS[role].includes(key) ? 'bg-mc-ok-soft text-green-800' : 'bg-slate-100 text-slate-400'}`}><span aria-hidden>{PERMS[role].includes(key) ? '✓' : '–'}</span>{label}</span>)}
                </div>
              </div>
            ))}
          </div>
          <div className="m-3 rounded-lg border border-mc-cobalt-line bg-mc-cobalt-soft p-3 text-xs leading-relaxed text-mc-cobalt-hover">
            Each person taps their name and enters a private {PIN_MIN}–{PIN_MAX} digit PIN. PINs are stored hashed; a PIN you set for someone must be changed by them at their next sign-in. Keep one active owner account; the last active owner cannot be disabled.
          </div>
        </section>
      </div>

      {edit && <UserModal user={edit} users={users} onClose={() => setEdit(null)} />}
    </div>
  )
}

function StaffMetric({ label, value, detail, icon, tone = 'slate' }: { label: string; value: string | number; detail: string; icon: React.ReactNode; tone?: 'slate' | 'green' | 'blue' | 'amber' }) {
  const styles = {
    slate: 'bg-mc-panel text-mc-muted',
    green: 'bg-mc-ok-soft text-green-800',
    blue: 'bg-mc-cobalt-soft text-mc-cobalt-hover',
    amber: 'bg-mc-warn-soft text-amber-800',
  }
  return <div className="flex items-center gap-3 rounded-xl border border-mc-line bg-white px-4 py-3.5">
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${styles[tone]}`}>{icon}</span>
    <div className="min-w-0">
      <div className="mc-label truncate">{label}</div>
      <div className="mt-0.5 text-xl font-bold leading-none tabular-nums text-mc-ink">{value}</div>
      <div className="mt-1 truncate text-xs text-mc-muted">{detail}</div>
    </div>
  </div>
}

function RoleTag({ role }: { role: Role }) {
  const styles = role === 'owner' ? 'bg-mc-cobalt-soft text-mc-cobalt-hover' : role === 'manager' ? 'bg-mc-warn-soft text-amber-800' : 'bg-slate-100 text-slate-700'
  return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-bold capitalize ${styles}`}>{role}</span>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function UserModal({ user, users, onClose }: { user: Partial<User>; users: User[]; onClose: () => void }) {
  const toast = useToast()
  const { user: me } = useSession()
  const [u, setU] = useState(user)
  const [pin, setPin] = useState('')
  const isNew = u.id === undefined

  const save = async () => {
    try {
      if (!u.name?.trim()) throw new Error('Name is required')
      if (isNew || pin) {
        const weak = weakPinReason(pin)
        if (weak) throw new Error(weak)
      }
      const remainingOwners = users.filter((x) => x.role === 'owner' && x.active && x.id !== u.id).length
      if (remainingOwners === 0 && (u.role !== 'owner' || !u.active)) throw new Error('Keep at least one active owner')
      const rec = { ...u, name: u.name.trim() } as User
      if (pin) {
        rec.pinHash = hashPin(pin)
        // A PIN set by someone else is known to two people — the holder must replace it.
        rec.mustChangePin = rec.id !== me?.id ? true : undefined
      }
      delete rec.pin
      if (isNew) delete rec.id
      await db.users.put(rec)
      void pushUsers()
      await logActivity('user', `${isNew ? 'Added' : 'Updated'} staff ${rec.name}`, {
        detail: `${rec.role}${rec.active ? '' : ' · disabled'}${pin && !isNew ? ' · PIN reset' : ''}`,
        userId: me?.id,
        userName: me?.name,
      })
      toast(isNew ? `${rec.name} added` : 'Staff updated')
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <Modal
      title={isNew ? 'Add staff' : `Edit ${user.name}`}
      onClose={onClose}
      footer={
        <button className="btn-primary" onClick={save}>
          Save
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className="input" value={u.name ?? ''} onChange={(e) => setU({ ...u, name: e.target.value })} autoFocus />
        </Field>
        <Field label={isNew ? `PIN (${PIN_MIN}–${PIN_MAX} digits)` : 'Reset PIN (optional)'}>
          <input
            className="input font-mono tracking-[0.3em]"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={PIN_MAX}
            placeholder={isNew ? '' : 'Leave blank to keep'}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field label="Role">
          <select className="input" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
        </Field>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={u.active} onChange={(e) => setU({ ...u, active: e.target.checked })} /> Active
        </label>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Give the PIN to the staff member in person. They will be asked to choose their own private PIN the first time they sign in.
      </p>
    </Modal>
  )
}
