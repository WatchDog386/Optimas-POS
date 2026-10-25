import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Circle, ShieldAlert, Sparkles, X } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { loadBarcodePrinterConfig, loadPrinterConfig } from '../lib/printer'
import { serverLink, type ServerLink } from '../lib/api'
import { useSyncStatus } from '../lib/sync'
import { money } from '../lib/money'
import type { LogEntry, Sale, User } from '../db/types'


function startOfDay(t = Date.now()): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}


/** First-run checklist shown until the shop is ready to trade (or dismissed). */
export function SetupChecklist() {
  const settings = useSettings()
  const dismissed = useLiveQuery(() => db.kv.get('ui:setupChecklistDone'), [])
  const counts = useLiveQuery(
    async () => ({
      staff: await db.users.filter((u) => u.active && u.role !== 'owner').count(),
      products: await db.products.count(),
      sales: await db.sales.count(),
      backup: await db.logs.where('kind').equals('system').filter((l) => l.action === 'Backup downloaded').count(),
    }),
    [],
  )
  const sync = useSyncStatus()
  const [link, setLink] = useState<ServerLink | null>(null)
  useEffect(() => {
    void serverLink().then(setLink)
  }, [sync.state])
  if (!counts || dismissed?.value) return null

  const labelReady = loadBarcodePrinterConfig().mode !== 'browser'
  const receiptReady = loadPrinterConfig().mode !== 'browser'
  const steps: { done: boolean; title: string; detail: string; to: string }[] = [
    { done: !!settings.phone && !!settings.address, title: 'Shop details', detail: 'Phone, address and KRA PIN for receipts', to: '/settings' },
    {
      done: link === 'connected' || !!sync.lastSync,
      title: 'Connect the shop server',
      detail: link === 'needs-setup' ? 'Settings → Security → enter the setup code' : 'Needed for STK Push, LAN printers and more tills',
      to: '/settings',
    },
    { done: receiptReady, title: 'Receipt printer', detail: 'Pair the 80 mm printer and test the cash drawer', to: '/settings' },
    { done: labelReady, title: 'Xprinter label printer', detail: 'Pick label size, pair, print a test label', to: '/settings' },
    { done: counts.staff > 0, title: 'Add your staff', detail: 'Cashiers and managers with their own PINs', to: '/staff' },
    { done: counts.products > 0, title: 'Add your first part', detail: 'Opening stock prints one serial label per unit', to: '/inventory?new=1' },
    { done: counts.sales > 0, title: 'Ring up a test sale', detail: 'Scan a label, take payment, print the receipt', to: '/sell' },
    { done: counts.backup > 0, title: 'Download a backup', detail: 'Do this daily — Settings → Backup', to: '/settings' },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white shadow-card">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-white">
            <Sparkles size={18} />
          </span>
          <div>
            <h2 className="text-base font-bold text-navy-900">Get ready to trade</h2>
            <p className="text-sm text-slate-600">
              {done} of {steps.length} done
            </p>
          </div>
        </div>
        <button
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700"
          title="Hide checklist"
          onClick={() => void db.kv.put({ key: 'ui:setupChecklistDone', value: true })}
        >
          <X size={16} />
        </button>
      </div>
      <div className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-brand-100">
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="grid gap-1 p-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => (
          <li key={s.title}>
            <Link to={s.to} className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-white ${s.done ? 'opacity-60' : ''}`}>
              {s.done ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={18} className="mt-0.5 shrink-0 text-slate-300" />}
              <span>
                <span className={`block text-sm font-semibold ${s.done ? 'text-slate-500 line-through' : 'text-navy-900'}`}>{s.title}</span>
                <span className="block text-xs text-slate-500">{s.detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Refunds, discounts, voids and wrong PINs today, plus takings by staff — the owner's shrinkage watch. */
export function LossPreventionPanel() {
  const settings = useSettings()
  const today = startOfDay()
  const sales = useLiveQuery(() => db.sales.where('createdAt').aboveOrEqual(today).toArray(), [today], [] as Sale[])
  const logs = useLiveQuery(() => db.logs.where('at').aboveOrEqual(today).toArray(), [today], [] as LogEntry[])
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  const watch = useMemo(() => {
    const refunds = sales.filter((s) => s.refundOf)
    return {
      refunds: refunds.reduce((sum, s) => sum - s.total, 0),
      refundCount: refunds.length,
      discounts: sales.filter((s) => !s.refundOf && s.status !== 'voided').reduce((sum, s) => sum + s.discount + s.lines.reduce((n, l) => n + l.discount, 0), 0),
      voids: logs.filter((l) => l.action === 'Sale voided before payment').length,
      wrongPins: logs.filter((l) => l.action === 'Wrong PIN').length,
      deletes: logs.filter((l) => l.action.startsWith('Part deleted') || l.action === 'Inventory cleared').length,
    }
  }, [sales, logs])

  const staff = useMemo(() => {
    const byUser = new Map<number, { total: number; count: number }>()
    for (const s of sales) {
      if (s.status === 'voided') continue
      const row = byUser.get(s.userId) ?? { total: 0, count: 0 }
      row.total += s.total
      if (s.total > 0) row.count++
      byUser.set(s.userId, row)
    }
    return [...byUser.entries()].map(([id, r]) => ({ name: users.find((u) => u.id === id)?.name ?? `User ${id}`, ...r })).sort((a, b) => b.total - a.total)
  }, [sales, users])

  const rows: [string, string, boolean][] = [
    ['Refunds', watch.refundCount ? `${watch.refundCount} · ${money(watch.refunds, settings.currency)}` : 'None', watch.refundCount > 0],
    ['Discounts given', watch.discounts ? money(watch.discounts, settings.currency) : 'None', watch.discounts > 0],
    ['Sales voided before payment', String(watch.voids), watch.voids > 0],
    ['Parts deleted', String(watch.deletes), watch.deletes > 0],
    ['Wrong PIN attempts', String(watch.wrongPins), watch.wrongPins >= 3],
  ]

  return (
    <section className="grid gap-4 rounded-xl bg-white p-5 shadow-card lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-adm-primary">
            <ShieldAlert size={18} className="text-adm-blue" /> Loss prevention · today
          </h2>
          <Link to="/logs" className="flex items-center gap-1 text-xs font-semibold text-adm-blue">
            Activity log <ArrowRight size={13} />
          </Link>
        </div>
        <ul className="divide-y divide-adm-low text-sm">
          {rows.map(([label, value, flag]) => (
            <li key={label} className="flex items-center justify-between py-2">
              <span className="text-adm-muted">{label}</span>
              <span className={`font-semibold tabular-nums ${flag ? 'text-amber-700' : 'text-adm-ink'}`}>{value}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-adm-muted">Takings by staff</h3>
        {staff.length === 0 ? (
          <p className="text-sm text-adm-muted">No sales yet today.</p>
        ) : (
          <ul className="space-y-2">
            {staff.map((s) => (
              <li key={s.name} className="flex items-center justify-between rounded-lg bg-adm-low px-3 py-2 text-sm">
                <span className="font-semibold">{s.name}</span>
                <span className="tabular-nums text-adm-muted">
                  {s.count} sale{s.count === 1 ? '' : 's'} · <b className="text-adm-ink">{money(s.total, settings.currency)}</b>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
