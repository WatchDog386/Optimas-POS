import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, type NavigateFunction } from 'react-router-dom'
import { CheckCircle2, ClipboardList, PackageSearch, Plus, ShoppingCart, Trash2, Truck, UserRound, Wrench } from 'lucide-react'
import { db } from '../db/db'
import { nextNumber, useSettings } from '../db/settings'
import type { Customer, JobStatus, Product, ServiceJob } from '../db/types'
import { lineTotal } from '../lib/cart'
import { money, toCents } from '../lib/money'
import { Modal, PageHeader, useToast } from '../components/ui'
import CustomerPicker from '../components/CustomerPicker'
import { CART_KEY, lineFromProduct } from './SellPage'

const COLUMNS: { id: JobStatus; label: string; tone: string; dot: string }[] = [
  { id: 'open', label: 'Booked in', tone: 'border-t-slate-400', dot: 'bg-slate-400' },
  { id: 'in_progress', label: 'Being worked on', tone: 'border-t-sky-500', dot: 'bg-sky-500' },
  { id: 'waiting_parts', label: 'Waiting for parts', tone: 'border-t-amber-500', dot: 'bg-amber-500' },
  { id: 'ready', label: 'Ready for pickup', tone: 'border-t-emerald-500', dot: 'bg-emerald-500' },
]

function jobValue(j: ServiceJob): number {
  return j.lines.reduce((s, l) => s + lineTotal(l), 0) + j.labour
}

function ageLabel(from: number): string {
  const ms = Math.max(0, Date.now() - from)
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function timeAgo(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })
}

/** Hand the finished job's parts + labour to the Sell screen as a parked cart. */
async function billJob(rec: ServiceJob, navigate: NavigateFunction): Promise<void> {
  const lines = [...rec.lines]
  if (rec.labour > 0) lines.push({ name: `Labour – ${rec.jobNo}`, qty: 1, unitPrice: rec.labour, unitCost: 0, discount: 0, taxable: true })
  await db.jobs.put({ ...rec, status: 'collected', updatedAt: Date.now() })
  try {
    localStorage.setItem(CART_KEY, JSON.stringify({ lines, discount: 0, customerId: rec.customerId }))
  } catch {
    throw new Error('Could not hand the job to the till (storage blocked)')
  }
  navigate('/sell')
}

export default function ServicePage() {
  const [open, setOpen] = useState<ServiceJob | 'new' | null>(null)
  const settings = useSettings()
  const navigate = useNavigate()
  const toast = useToast()

  const allJobs = useLiveQuery(() => db.jobs.toArray(), [], [] as ServiceJob[])
  const jobs = useMemo(
    () => allJobs.filter((j) => j.status !== 'collected').sort((a, b) => a.createdAt - b.createdAt),
    [allJobs],
  )

  const monthStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(1)
    return d.getTime()
  }, [])

  const counts = useMemo(() => {
    const c: Record<JobStatus, number> = { open: 0, in_progress: 0, waiting_parts: 0, ready: 0, collected: 0 }
    for (const j of allJobs) c[j.status]++
    return c
  }, [allJobs])

  const addedToday = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return allJobs.filter((j) => j.createdAt >= start.getTime()).length
  }, [allJobs])

  const collectedMonth = useMemo(() => {
    const list = allJobs.filter((j) => j.status === 'collected' && j.updatedAt >= monthStart)
    const value = list.reduce((s, j) => s + jobValue(j), 0)
    return { count: list.length, value }
  }, [allJobs, monthStart])

  const waitingOldest = useMemo(() => {
    const list = jobs.filter((j) => j.status === 'waiting_parts')
    return list.length ? Math.max(...list.map((j) => Date.now() - j.createdAt)) : 0
  }, [jobs])

  const workload = useMemo(() => {
    const map = new Map<string, { count: number; ready: number }>()
    for (const j of jobs) {
      const key = j.mechanic?.trim() || 'Unassigned'
      const cur = map.get(key) ?? { count: 0, ready: 0 }
      cur.count++
      if (j.status === 'ready') cur.ready++
      map.set(key, cur)
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [jobs])

  const waitingList = useMemo(
    () => jobs.filter((j) => j.status === 'waiting_parts').sort((a, b) => a.createdAt - b.createdAt).slice(0, 6),
    [jobs],
  )

  const recent = useMemo(
    () => [...jobs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6),
    [jobs],
  )

  const advance = async (j: ServiceJob, to: JobStatus) => {
    await db.jobs.put({ ...j, status: to, updatedAt: Date.now() })
    toast(`${j.jobNo} → ${COLUMNS.find((c) => c.id === to)?.label ?? to}`)
  }

  const bill = async (j: ServiceJob) => {
    try {
      await billJob(j, navigate)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not bill job', 'error')
    }
  }

  const kpis = [
    {
      label: 'Booked in',
      value: counts.open,
      sub: addedToday > 0 ? `${addedToday} added today` : 'Nothing booked in today',
      icon: ClipboardList,
      bg: 'bg-[#2196F3]',
      text: '',
    },
    {
      label: 'In progress',
      value: counts.in_progress,
      sub: workload.length > 1 ? `${workload.filter(([n]) => n !== 'Unassigned').length} mechanics on jobs` : 'On the bench now',
      icon: Wrench,
      bg: 'bg-[#F4600F]',
      text: '',
    },
    {
      label: 'Waiting parts',
      value: counts.waiting_parts,
      sub: waitingOldest > 0 ? `Oldest waiting ${ageLabel(Date.now() - waitingOldest)}` : 'Nothing on backorder',
      icon: Truck,
      bg: 'bg-[#FDD835] text-slate-900',
      text: '',
    },
    {
      label: 'Ready to collect',
      value: counts.ready,
      sub: collectedMonth.count > 0 ? `${collectedMonth.count} collected this month` : 'Billed at the till when picked up',
      icon: CheckCircle2,
      bg: 'bg-[#1e3f46]',
      text: '',
    },
  ]

  const maxLoad = Math.max(1, ...workload.map(([, v]) => v.count))

  return (
    <div className="flex h-full flex-col p-4 lg:p-6">
      <PageHeader
        title="Service & fitting jobs"
        subtitle="Track bikes in the workshop, the parts used and labour, then bill at the till"
        actions={
          <button className="btn-primary" onClick={() => setOpen('new')}>
            <Plus size={16} /> Book in a bike
          </button>
        }
      />

      {/* KPI cards */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, sub, icon: Icon, bg }) => (
          <div key={label} className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-md ${bg}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-3xl font-extrabold leading-tight">{value}</div>
              <Icon size={26} className="shrink-0 opacity-80" />
            </div>
            <div className="mt-1.5 text-base font-bold">{label}</div>
            <div className="mt-0.5 text-sm opacity-90">{sub}</div>
          </div>
        ))}
      </div>

      {/* Pipeline board */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = jobs.filter((j) => j.status === col.id)
          return (
            <div key={col.id} className={`flex min-h-0 flex-col rounded-xl border-t-4 bg-slate-200/60 ${col.tone}`}>
              <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700">
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                  {col.label}
                </span>
                <span className="rounded-full bg-white px-2 text-xs font-bold text-slate-500">{list.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {list.map((j) => (
                  <button key={j.id} onClick={() => setOpen(j)} className="card block w-full p-3 text-left hover:border-brand-400">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span className="font-mono font-semibold">{j.jobNo}</span>
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                        {ageLabel(j.createdAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 font-semibold text-slate-900">{j.customerName}</div>
                    <div className="text-xs text-slate-600">{[j.bikeModel, j.plate].filter(Boolean).join(' · ')}</div>
                    <div className="mt-1 line-clamp-2 text-sm text-slate-700">{j.complaint}</div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      {j.mechanic ? (
                        <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                          <UserRound size={11} /> {j.mechanic}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-400">Unassigned</span>
                      )}
                      <span className="font-bold text-slate-800">{money(jobValue(j), settings.currency)}</span>
                    </div>
                    {(j.lines.length > 0 || j.labour > 0) && (
                      <div className="mt-1 text-[11px] text-slate-400">
                        {j.lines.length} part{j.lines.length === 1 ? '' : 's'}
                        {j.labour > 0 ? ` · labour ${money(j.labour, settings.currency)}` : ''}
                      </div>
                    )}
                    <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {j.status === 'open' && (
                        <button className="btn-dark h-7 flex-1 px-2 py-0 text-xs" onClick={() => advance(j, 'in_progress')}>
                          Start work
                        </button>
                      )}
                      {j.status === 'in_progress' && (
                        <>
                          <button className="btn-ghost h-7 px-2 py-0 text-xs" onClick={() => advance(j, 'waiting_parts')}>
                            Needs parts
                          </button>
                          <button className="btn-dark h-7 flex-1 px-2 py-0 text-xs" onClick={() => advance(j, 'ready')}>
                            Mark ready
                          </button>
                        </>
                      )}
                      {j.status === 'waiting_parts' && (
                        <button className="btn-dark h-7 flex-1 px-2 py-0 text-xs" onClick={() => advance(j, 'ready')}>
                          Parts arrived
                        </button>
                      )}
                      {j.status === 'ready' && (
                        <button className="btn-primary h-7 flex-1 px-2 py-0 text-xs" onClick={() => bill(j)}>
                          <ShoppingCart size={12} className="mr-1 inline" /> Bill at till
                        </button>
                      )}
                    </div>
                  </button>
                ))}
                {list.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">
                    No jobs here
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Workshop widgets */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-navy-900">Mechanic load</h2>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Active jobs</span>
          </div>
          {workload.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No active jobs on the board.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {workload.map(([name, v]) => (
                <li key={name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                      <UserRound size={13} className="text-slate-400" /> {name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {v.count} job{v.count === 1 ? '' : 's'}
                      {v.ready > 0 ? ` · ${v.ready} ready` : ''}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(v.count / maxLoad) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Collected this month</span>
            <span className="font-bold text-slate-800">
              {collectedMonth.count} · {money(collectedMonth.value, settings.currency)}
            </span>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-navy-900">Waiting on parts</h2>
            <PackageSearch size={17} className="text-amber-500" />
          </div>
          {waitingList.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing on backorder — suppliers are caught up.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {waitingList.map((j) => {
                const days = Math.floor((Date.now() - j.createdAt) / 86_400_000)
                return (
                  <li key={j.id}>
                    <button className="flex w-full items-center justify-between gap-2 py-2.5 text-left hover:bg-slate-50" onClick={() => setOpen(j)}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-800">
                          {j.jobNo} · {j.customerName}
                        </span>
                        <span className="block truncate text-xs text-slate-500">{j.complaint}</span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                          days >= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {ageLabel(j.createdAt)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-navy-900">Recent updates</h2>
            <ClockDots />
          </div>
          {recent.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No open jobs yet — book in the first bike.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {recent.map((j) => {
                const col = COLUMNS.find((c) => c.id === j.status)
                return (
                  <li key={j.id} className="flex items-start gap-2.5">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${col?.dot ?? 'bg-slate-300'}`} />
                    <span className="min-w-0 flex-1">
                      <button className="block w-full text-left" onClick={() => setOpen(j)}>
                        <span className="block truncate text-sm font-semibold text-slate-800">
                          {j.jobNo} · {j.customerName}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {col?.label} · updated {timeAgo(j.updatedAt)}
                        </span>
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {open && <JobModal job={open === 'new' ? undefined : open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function ClockDots() {
  return (
    <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
      Live
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
    </span>
  )
}

function JobModal({ job, onClose }: { job?: ServiceJob; onClose: () => void }) {
  const settings = useSettings()
  const toast = useToast()
  const navigate = useNavigate()
  const products = useLiveQuery(() => db.products.filter((p) => p.active && p.trackStock).sortBy('name'), [], [] as Product[])
  const [j, setJ] = useState<Partial<ServiceJob>>(job ?? { status: 'open', lines: [], labour: 0, customerName: '', complaint: '' })
  const [labour, setLabour] = useState(String((job?.labour ?? 0) / 100))
  const [picking, setPicking] = useState(false)
  const [pick, setPick] = useState('')
  const set = <K extends keyof ServiceJob>(k: K, v: ServiceJob[K]) => setJ((x) => ({ ...x, [k]: v }))

  const partsTotal = (j.lines ?? []).reduce((s, l) => s + lineTotal(l), 0)
  const total = partsTotal + toCents(labour)
  const c = settings.currency

  const persist = async (patch: Partial<ServiceJob> = {}): Promise<ServiceJob> => {
    const now = Date.now()
    const rec = { ...j, ...patch, labour: toCents(labour), updatedAt: now } as ServiceJob
    if (!rec.id) {
      rec.jobNo = await nextNumber('JOB')
      rec.createdAt = now
      delete rec.id
    }
    rec.id = (await db.jobs.put(rec)) as number
    return rec
  }

  const save = async () => {
    if (!j.customerName?.trim() || !j.complaint?.trim()) return toast('Customer and job description are required', 'error')
    await persist()
    toast('Job saved')
    onClose()
  }

  const billAtTill = async () => {
    const rec = await persist({ status: 'collected' })
    try {
      await billJob(rec, navigate)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not hand the job to the till', 'error')
    }
  }

  const addPart = () => {
    const p = products.find((x) => String(x.id) === pick)
    if (!p) return
    set('lines', [...(j.lines ?? []), lineFromProduct(p)])
    setPick('')
  }

  return (
    <Modal
      title={job ? `Job ${job.jobNo}` : 'Book in a bike'}
      onClose={onClose}
      wide
      footer={
        <>
          {job && (
            <button className="btn-ghost mr-auto text-red-600" onClick={async () => (await db.jobs.delete(job.id!), onClose())}>
              Delete job
            </button>
          )}
          <button className="btn-ghost" onClick={save}>
            Save
          </button>
          {job && (
            <button className="btn-primary" onClick={billAtTill} disabled={total <= 0}>
              <ShoppingCart size={16} /> Bill at till · {money(total, c)}
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="label">Customer *</label>
          <div className="flex gap-2">
            <input className="input" value={j.customerName ?? ''} onChange={(e) => set('customerName', e.target.value)} placeholder="Name" />
            <button className="btn-ghost" onClick={() => setPicking(true)} title="Pick saved customer">
              <UserRound size={16} />
            </button>
          </div>
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={j.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">Bike model</label>
          <select className="input" value={j.bikeModel ?? ''} onChange={(e) => set('bikeModel', e.target.value || undefined)}>
            <option value="">—</option>
            {settings.bikeModels.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Plate</label>
          <input className="input uppercase" value={j.plate ?? ''} onChange={(e) => set('plate', e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className="label">Mechanic</label>
          <input className="input" value={j.mechanic ?? ''} onChange={(e) => set('mechanic', e.target.value)} />
        </div>
        <div className="md:col-span-3">
          <label className="label">Problem / work requested *</label>
          <textarea className="input" rows={2} value={j.complaint ?? ''} onChange={(e) => set('complaint', e.target.value)} placeholder="e.g. front brakes squeaking, replace pads; throttle not responding" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {COLUMNS.map((c2) => (
          <button key={c2.id} className={j.status === c2.id ? 'btn-dark' : 'btn-ghost'} onClick={() => set('status', c2.id)}>
            {c2.label}
          </button>
        ))}
      </div>

      <h3 className="mb-2 mt-5 font-semibold">Parts used</h3>
      {(j.lines ?? []).map((l, i) => (
        <div key={i} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm">
          <span className="flex-1">{l.name}</span>
          <input
            className="input w-16"
            type="number"
            min={1}
            value={l.qty}
            onChange={(e) => set('lines', j.lines!.map((x, k) => (k === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))}
          />
          <span className="w-24 text-right">{money(lineTotal(l), c)}</span>
          <button className="text-slate-400 hover:text-red-600" onClick={() => set('lines', j.lines!.filter((_, k) => k !== i))} aria-label="Remove part">
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <select className="input flex-1" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a part…</option>
          {products
            .filter((p) => !j.bikeModel || p.fitment.length === 0 || p.fitment.includes(j.bikeModel))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {money(p.price, c)} ({p.stock} in stock)
              </option>
            ))}
        </select>
        <button className="btn-dark" onClick={addPart} disabled={!pick}>
          Add
        </button>
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="w-52">
          <label className="label">Labour charge ({c})</label>
          <input className="input" inputMode="decimal" value={labour} onChange={(e) => setLabour(e.target.value)} />
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-500">Parts {money(partsTotal, c)}</div>
          <div className="text-xl font-bold">Total {money(total, c)}</div>
        </div>
      </div>

      {picking && (
        <CustomerPicker
          onClose={() => setPicking(false)}
          onPick={(c2?: Customer) => {
            if (c2)
              setJ((x) => ({ ...x, customerId: c2.id, customerName: c2.name, phone: c2.phone, bikeModel: c2.bikeModel ?? x.bikeModel, plate: c2.plate ?? x.plate }))
            setPicking(false)
          }}
        />
      )}
    </Modal>
  )
}
