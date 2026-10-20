import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2 } from 'lucide-react'
import { db } from '../db/db'
import { logActivity } from '../db/logs'
import type { LogEntry, LogKind, MovementReason } from '../db/types'
import { useSession } from '../session'
import { Badge, ListPanel, PageHeader, Segmented, useToast } from '../components/ui'

type KindFilter = 'all' | 'auth' | 'sale' | 'stock' | 'shift' | 'admin'

const KIND_OPTIONS: Record<KindFilter, string> = {
  all: 'All',
  auth: 'Sign-ins',
  sale: 'Sales',
  stock: 'Stock',
  shift: 'Shifts',
  admin: 'Admin',
}

const KIND_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  auth: 'blue',
  sale: 'green',
  stock: 'amber',
  shift: 'slate',
  settings: 'slate',
  user: 'slate',
  system: 'red',
}

const KIND_LABEL: Record<LogKind, string> = {
  auth: 'Sign-in',
  sale: 'Sale',
  stock: 'Stock',
  shift: 'Shift',
  settings: 'Settings',
  user: 'Staff',
  system: 'System',
}

const MOVEMENT_LABEL: Record<MovementReason, string> = {
  sale: 'Sold',
  refund: 'Refunded',
  receive: 'Received',
  adjust: 'Adjusted',
  damage: 'Damaged',
  count: 'Counted',
}

function matches(kind: LogKind, f: KindFilter): boolean {
  if (f === 'all') return true
  if (f === 'admin') return kind === 'settings' || kind === 'user' || kind === 'system'
  return kind === f
}

function fmtTime(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })} ${time}`
}

export default function LogsPage() {
  const toast = useToast()
  const { user: me } = useSession()
  const [kind, setKind] = useState<KindFilter>('all')
  const [q, setQ] = useState('')

  const logs = useLiveQuery(() => db.logs.orderBy('at').reverse().limit(500).toArray(), [], [] as LogEntry[])
  const movements = useLiveQuery(() => db.movements.orderBy('at').reverse().limit(500).toArray(), [], [])
  const products = useLiveQuery(() => db.products.toArray(), [], [])
  const users = useLiveQuery(() => db.users.toArray(), [], [])

  const rows = useMemo(() => {
    const userNames = new Map((users ?? []).map((u) => [u.id, u.name]))
    const productNames = new Map((products ?? []).map((p) => [p.id, p.name]))

    const entries: LogEntry[] = (logs ?? [])
      .filter((l) => l.kind !== 'stock')
      .map((l) => ({ ...l, userName: l.userName ?? userNames.get(l.userId) }))

    if (kind === 'all' || kind === 'stock') {
      for (const m of movements ?? []) {
        entries.push({
          at: m.at,
          kind: 'stock',
          action: MOVEMENT_LABEL[m.reason] ?? m.reason,
          detail: [`${m.change > 0 ? '+' : ''}${m.change} × ${productNames.get(m.productId) ?? `#${m.productId}`}`, m.note, m.reference]
            .filter(Boolean)
            .join(' · '),
          userId: m.userId,
          userName: userNames.get(m.userId),
        })
      }
    }

    const needle = q.trim().toLowerCase()
    return entries
      .filter((e) => matches(e.kind, kind))
      .filter((e) => !needle || [e.action, e.detail, e.userName].filter(Boolean).some((s) => s!.toLowerCase().includes(needle)))
      .sort((a, b) => b.at - a.at)
      .slice(0, 500)
  }, [logs, movements, products, users, kind, q])

  const clearLog = async () => {
    if (!confirm('Clear the activity log? Sales, stock and shift records are kept — only this audit trail is removed.')) return
    await db.logs.clear()
    await logActivity('system', 'Log cleared', { userId: me?.id, userName: me?.name })
    toast('Activity log cleared')
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Activity log" subtitle="Sign-ins, sales, stock changes, shift and settings events on this device" />

      {/* Mobile: search + kind dropdown (replaces the panel bar and pills) */}
      <div className="mb-3 flex items-center gap-2 sm:hidden">
        <input
          className="input h-9 min-w-0 flex-1 text-sm"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input h-9 w-32 shrink-0 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as KindFilter)}
          aria-label="Filter events"
        >
          {Object.entries(KIND_OPTIONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <ListPanel
        title="Events"
        barClassName="hidden sm:flex"
        toolbarClassName="hidden sm:flex"
        actions={
          <input
            className="input h-8 w-48 border-0 bg-white py-1 text-sm"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
        toolbar={<Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />}
        footer={
          <>
            <span>
              {rows.length} event{rows.length === 1 ? '' : 's'}
            </span>
            {me?.role === 'owner' && rows.length > 0 && (
              <button className="btn-ghost h-7 px-2 py-0 text-xs text-red-600" onClick={clearLog}>
                <Trash2 size={13} /> Clear log
              </button>
            )}
          </>
        }
      >
        <table className="w-full">
          <thead className="table-head">
            <tr>
              <th className="w-32">When</th>
              <th className="w-24">Type</th>
              <th>Event</th>
              <th>Detail</th>
              <th className="hidden w-40 sm:table-cell">User</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="table-row hover:bg-slate-50">
                <td className="whitespace-nowrap font-mono text-xs text-slate-500">{fmtTime(e.at)}</td>
                <td>
                  <Badge tone={KIND_TONE[e.kind] ?? 'slate'}>{KIND_LABEL[e.kind] ?? e.kind}</Badge>
                </td>
                <td className="font-semibold text-slate-800">{e.action}</td>
                <td className="text-slate-500">{e.detail ?? '—'}</td>
                <td className="hidden text-slate-600 sm:table-cell">{e.userName ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-sm text-slate-500">
                  No events{q ? ` matching “${q}”` : kind !== 'all' ? ` in ${KIND_OPTIONS[kind].toLowerCase()}` : ' yet'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ListPanel>
      <p className="mt-3 text-xs text-slate-500">
        Entries are kept on this device (latest 500 shown). Stock rows come from the inventory movement history; everything else from the audit log.
      </p>
    </div>
  )
}
