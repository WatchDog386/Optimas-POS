import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCheck, PackageSearch, UserRound, Wallet, Wrench } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { useSession } from '../session'
import { Badge, ListPanel, PageHeader } from '../components/ui'
import { money } from '../lib/money'
import type { Customer, Product, ServiceJob } from '../db/types'

interface Noti {
  id: string
  tone: 'amber' | 'red' | 'blue' | 'slate'
  label: string
  icon: typeof Wrench
  iconClass: string
  title: string
  body: string
  at: number
}

function timeAgo(at: number) {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })
}

export default function NotificationsPage() {
  const settings = useSettings()
  const { shift } = useSession()
  const [read, setRead] = useState<Set<string>>(new Set())

  const lowStock = useLiveQuery(
    () => db.products.filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel).toArray(),
    [],
    [] as Product[],
  )
  const owing = useLiveQuery(
    () => db.customers.filter((c) => c.balance > 0).toArray(),
    [],
    [] as Customer[],
  )
  const jobs = useLiveQuery(
    () => db.jobs.filter((j) => j.status === 'ready' || j.status === 'waiting_parts').toArray(),
    [],
    [] as ServiceJob[],
  )

  const items = useMemo(() => {
    const out: Noti[] = []

    if (settings.notifyLowStock) {
      for (const p of lowStock) {
        out.push({
          id: `stock:${p.id}`,
          tone: p.stock <= 0 ? 'red' : 'amber',
          label: p.stock <= 0 ? 'Out of stock' : 'Low stock',
          icon: PackageSearch,
          iconClass: p.stock <= 0 ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500',
          title: p.name,
          body:
            p.stock <= 0
              ? `Out of stock${p.location ? ` · shelf ${p.location}` : ''} — reorder from your supplier`
              : `${p.stock} left (reorder at ${p.reorderLevel})${p.location ? ` · shelf ${p.location}` : ''}`,
          at: p.updatedAt,
        })
      }
    }

    if (settings.notifyOwing) {
      for (const c of owing) {
        out.push({
          id: `credit:${c.id}`,
          tone: 'blue',
          label: 'Credit',
          icon: UserRound,
          iconClass: 'bg-sky-50 text-sky-500',
          title: c.name,
          body: `Owes ${money(c.balance, settings.currency)}${c.creditLimit > 0 ? ` of ${money(c.creditLimit, settings.currency)} limit` : ''}`,
          at: c.createdAt,
        })
      }
    }

    if (settings.notifyJobUpdates) {
      for (const j of jobs) {
        out.push({
          id: `job:${j.id}`,
          tone: 'slate',
          label: j.status === 'ready' ? 'Ready' : 'Waiting parts',
          icon: Wrench,
          iconClass: 'bg-violet-50 text-violet-500',
          title: `${j.jobNo} · ${j.customerName}`,
          body:
            j.status === 'ready'
              ? 'Job complete — ready for collection and payment'
              : 'Waiting for parts — chase your supplier',
          at: j.updatedAt,
        })
      }
    }

    if (!shift) {
      out.push({
        id: 'shift:open',
        tone: 'red',
        label: 'Shift',
        icon: Wallet,
        iconClass: 'bg-red-50 text-red-500',
        title: 'No open shift',
        body: 'Open a shift with a float before recording sales',
        at: Date.now(),
      })
    }

    return out.sort((a, b) => b.at - a.at)
  }, [lowStock, owing, jobs, shift, settings.currency, settings.notifyLowStock, settings.notifyOwing, settings.notifyJobUpdates])

  const unread = items.filter((i) => !read.has(i.id))

  return (
    <div className="p-6">
      <PageHeader
        title="Notifications"
        subtitle={`${unread.length} unread · stock, credit, service jobs and shift alerts — choose groups in Settings → Notifications`}
        actions={
          unread.length > 0 ? (
            <button
              className="btn-ghost"
              onClick={() => setRead(new Set(items.map((i) => i.id)))}
            >
              <CheckCheck size={16} /> Mark all as read
            </button>
          ) : undefined
        }
      />

      <ListPanel
        title="All notifications"
        actions={<Badge tone="blue">{items.length} total</Badge>}
      >
        {items.length === 0 ? (
          <div className="px-4">
            <div className="py-12 text-center text-sm text-slate-500">
              All clear — no stock, credit or job alerts right now.
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => {
              const isRead = read.has(n.id)
              const Icon = n.icon
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setRead((prev) => new Set(prev).add(n.id))}
                    className={`flex w-full items-start gap-4 px-4 py-3.5 text-left transition hover:bg-slate-50 ${
                      isRead ? 'opacity-70' : 'bg-white'
                    }`}
                  >
                    <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${n.iconClass}`}>
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{n.title}</span>
                        <Badge tone={n.tone}>{n.label}</Badge>
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-500">{n.body}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-slate-400">
                      {timeAgo(n.at)}
                      {!isRead && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ListPanel>
    </div>
  )
}
