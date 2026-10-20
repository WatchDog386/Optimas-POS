import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Minus, Plus } from 'lucide-react'
import { db } from '../db/db'
import { logActivity } from '../db/logs'
import type { Role, User } from '../db/types'
import { PERMS, PIN_LENGTH, useSession, type Permission } from '../session'
import { Badge, ListPanel, Modal, PageHeader, errorText, useToast } from '../components/ui'

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

  // Sales count (rolling 30 days) per user id.
  const salesByUser = useLiveQuery(
    async () => {
      const since = Date.now() - 30 * 86_400_000
      const sales = await db.sales.where('createdAt').above(since).toArray()
      const counts: Record<number, number> = {}
      for (const s of sales) if (s.total > 0 && s.userId) counts[s.userId] = (counts[s.userId] ?? 0) + 1
      return counts
    },
    [],
    {} as Record<number, number>,
  )

  const filtered = users.filter((u) => u.name.toLowerCase().includes(q.trim().toLowerCase()))
  const active = users.filter((u) => u.active).length

  const toggleActive = async (u: User) => {
    if (u.active && u.role === 'owner' && users.filter((x) => x.role === 'owner' && x.active && x.id !== u.id).length === 0) {
      return toast('Keep at least one active owner', 'error')
    }
    await db.users.update(u.id!, { active: !u.active })
    await logActivity('user', `${u.name} ${u.active ? 'deactivated' : 'reactivated'}`, { userId: me?.id, userName: me?.name })
    toast(`${u.name} ${u.active ? 'deactivated' : 'reactivated'}`)
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Staff"
        subtitle={`${users.length} user${users.length === 1 ? '' : 's'} · ${active} active`}
        actions={
          <button className="btn-primary" onClick={() => setEdit({ role: 'cashier', active: true })}>
            <Plus size={16} /> Add staff
          </button>
        }
      />

      {/* Mobile: search (replaces the dark toolbar) */}
      <div className="mb-3 sm:hidden">
        <input
          className="input h-9 w-full text-sm"
          placeholder="Search name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <ListPanel
        title="Team"
        barClassName="hidden sm:flex"
        toolbarClassName="hidden sm:flex"
        toolbar={
          <input
            className="input h-8 w-56 border-0 bg-white py-1 text-sm"
            placeholder="Search name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
        footer={
          <>
            <span>{filtered.length} shown</span>
            <span className="text-xs text-slate-500">Click a row to edit</span>
          </>
        }
      >
        <table className="w-full">
          <thead className="table-head">
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>PIN</th>
              <th className="text-right">Sales · 30d</th>
              <th>Status</th>
              <th className="text-right">Access</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="table-row cursor-pointer hover:bg-slate-50" onClick={() => setEdit(u)}>
                <td className="font-semibold">
                  {u.name} {u.id === me?.id && <span className="text-xs font-normal text-slate-400">(you)</span>}
                </td>
                <td>
                  <Badge tone={u.role === 'owner' ? 'blue' : u.role === 'manager' ? 'amber' : 'slate'}>{u.role}</Badge>
                </td>
                <td className="font-mono tracking-[0.25em] text-slate-400">{'•'.repeat(u.pin.length)}</td>
                <td className="text-right tabular-nums">{salesByUser[u.id ?? -1] ?? 0}</td>
                <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}</td>
                <td className="text-right">
                  <button
                    className="btn-ghost h-7 px-2 py-0 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      void toggleActive(u)
                    }}
                  >
                    {u.active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                  No staff match “{q}”
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ListPanel>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ListPanel title="Role permissions" barClassName="hidden sm:flex">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th>Role</th>
                {PERM_COLS.map((c) => (
                  <th key={c.key} className="text-center">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r} className="table-row">
                  <td className="font-semibold capitalize">{r}</td>
                  {PERM_COLS.map((c) => (
                    <td key={c.key} className="text-center">
                      {PERMS[r].includes(c.key) ? (
                        <Check size={15} className="mx-auto text-emerald-600" />
                      ) : (
                        <Minus size={15} className="mx-auto text-slate-300" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ListPanel>

        <div className="card p-5 text-sm leading-relaxed text-slate-600">
          <h3 className="mb-2 font-semibold text-slate-900">How roles work</h3>
          <ul className="space-y-1.5">
            <li>
              <b>Owner</b> — everything: settings, staff, logs, refunds, purchasing.
            </li>
            <li>
              <b>Manager</b> — refunds, discounts, inventory, purchasing, reports and the activity log.
            </li>
            <li>
              <b>Cashier</b> — selling, discounts, customers and service jobs.
            </li>
          </ul>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            Everyone signs in with a {PIN_LENGTH}-digit PIN. Keep at least one active owner — the app blocks disabling the last one.
          </p>
        </div>
      </div>

      {edit && <UserModal user={edit} users={users} onClose={() => setEdit(null)} />}
    </div>
  )
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

  const save = async () => {
    try {
      if (!u.name?.trim()) throw new Error('Name is required')
      if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(u.pin ?? '')) throw new Error(`PIN must be ${PIN_LENGTH} digits`)
      if (users.some((x) => x.pin === u.pin && x.id !== u.id)) throw new Error('That PIN is already used')
      const remainingOwners = users.filter((x) => x.role === 'owner' && x.active && x.id !== u.id).length
      if (remainingOwners === 0 && (u.role !== 'owner' || !u.active)) throw new Error('Keep at least one active owner')
      const rec = { ...u, name: u.name.trim() } as User
      const isNew = rec.id === undefined
      if (isNew) delete rec.id
      await db.users.put(rec)
      await logActivity('user', `${isNew ? 'Added' : 'Updated'} staff ${rec.name}`, {
        detail: `${rec.role}${rec.active ? '' : ' · disabled'}`,
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
      title={u.id ? `Edit ${user.name}` : 'Add staff'}
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
        <Field label={`PIN (${PIN_LENGTH} digits)`}>
          <input
            className="input font-mono"
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            value={u.pin ?? ''}
            onChange={(e) => setU({ ...u, pin: e.target.value.replace(/\D/g, '') })}
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
        PINs are stored on this device only and unlock the till — not a password for online accounts.
      </p>
    </Modal>
  )
}
