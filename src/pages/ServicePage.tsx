import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Plus, ShoppingCart, Trash2, UserRound } from 'lucide-react'
import { db } from '../db/db'
import { nextNumber, useSettings } from '../db/settings'
import type { Customer, JobStatus, Product, ServiceJob } from '../db/types'
import { lineTotal } from '../lib/cart'
import { money, toCents } from '../lib/money'
import { Modal, PageHeader, useToast } from '../components/ui'
import CustomerPicker from '../components/CustomerPicker'
import { CART_KEY, lineFromProduct } from './SellPage'

const COLUMNS: { id: JobStatus; label: string; tone: string }[] = [
  { id: 'open', label: 'Booked in', tone: 'border-t-slate-400' },
  { id: 'in_progress', label: 'Being worked on', tone: 'border-t-sky-500' },
  { id: 'waiting_parts', label: 'Waiting for parts', tone: 'border-t-amber-500' },
  { id: 'ready', label: 'Ready for pickup', tone: 'border-t-emerald-500' },
]

export default function ServicePage() {
  const [open, setOpen] = useState<ServiceJob | 'new' | null>(null)
  const jobs = useLiveQuery(() => db.jobs.where('status').notEqual('collected').sortBy('createdAt'), [], [] as ServiceJob[])

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="Service & fitting jobs"
        subtitle="Track bikes in the workshop, the parts used and labour, then bill at the till"
        actions={
          <button className="btn-primary" onClick={() => setOpen('new')}>
            <Plus size={16} /> Book in a bike
          </button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = jobs.filter((j) => j.status === col.id)
          return (
            <div key={col.id} className={`flex min-h-0 flex-col rounded-xl border-t-4 bg-slate-200/60 ${col.tone}`}>
              <div className="flex justify-between px-3 py-2 text-sm font-semibold text-slate-700">
                {col.label}
                <span className="text-slate-500">{list.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {list.map((j) => (
                  <button key={j.id} onClick={() => setOpen(j)} className="card block w-full p-3 text-left hover:border-brand-400">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span className="font-mono">{j.jobNo}</span>
                      <span>{new Date(j.createdAt).toLocaleDateString('en-KE')}</span>
                    </div>
                    <div className="font-semibold">{j.customerName}</div>
                    <div className="text-xs text-slate-600">{[j.bikeModel, j.plate].filter(Boolean).join(' · ')}</div>
                    <div className="mt-1 line-clamp-2 text-sm">{j.complaint}</div>
                    {j.mechanic && <div className="mt-1 text-xs text-slate-500">Mechanic: {j.mechanic}</div>}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {open && <JobModal job={open === 'new' ? undefined : open} onClose={() => setOpen(null)} />}
    </div>
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
    const lines = [...rec.lines]
    if (rec.labour > 0) lines.push({ name: `Labour – ${rec.jobNo}`, qty: 1, unitPrice: rec.labour, unitCost: 0, discount: 0, taxable: true })
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ lines, discount: 0, customerId: rec.customerId }))
    } catch {
      return toast('Could not hand the job to the till (storage blocked)', 'error')
    }
    navigate('/sell')
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
              <ShoppingCart size={16} /> Bill at till · {money(total)}
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
        {COLUMNS.map((c) => (
          <button key={c.id} className={j.status === c.id ? 'btn-dark' : 'btn-ghost'} onClick={() => set('status', c.id)}>
            {c.label}
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
          <span className="w-24 text-right">{money(lineTotal(l), '')}</span>
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
                {p.name} — {money(p.price, '')} ({p.stock} in stock)
              </option>
            ))}
        </select>
        <button className="btn-dark" onClick={addPart} disabled={!pick}>
          Add
        </button>
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="w-48">
          <label className="label">Labour charge (KES)</label>
          <input className="input" inputMode="decimal" value={labour} onChange={(e) => setLabour(e.target.value)} />
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-500">Parts {money(partsTotal)}</div>
          <div className="text-xl font-bold">Total {money(total)}</div>
        </div>
      </div>

      {picking && (
        <CustomerPicker
          onClose={() => setPicking(false)}
          onPick={(c?: Customer) => {
            if (c)
              setJ((x) => ({ ...x, customerId: c.id, customerName: c.name, phone: c.phone, bikeModel: c.bikeModel ?? x.bikeModel, plate: c.plate ?? x.plate }))
            setPicking(false)
          }}
        />
      )}
    </Modal>
  )
}
