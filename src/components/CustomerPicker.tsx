import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Search } from 'lucide-react'
import { Modal } from './ui'
import { db } from '../db/db'
import type { Customer } from '../db/types'
import { money } from '../lib/money'
import { useSettings } from '../db/settings'

export function CustomerForm({ initial, onSaved, onCancel }: { initial?: Partial<Customer>; onSaved: (c: Customer) => void; onCancel: () => void }) {
  const settings = useSettings()
  const [c, setC] = useState<Partial<Customer>>({ balance: 0, creditLimit: 0, ...initial })
  const set = (k: keyof Customer, v: unknown) => setC((x) => ({ ...x, [k]: v }))
  const save = async () => {
    if (!c.name?.trim()) return
    const record = { ...c, name: c.name.trim(), createdAt: c.createdAt ?? Date.now() } as Customer
    if (record.id === undefined) delete record.id
    record.id = (await db.customers.put(record)) as number
    onSaved(record)
  }
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Name *</label>
        <input className="input" value={c.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Phone</label>
          <input className="input" value={c.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">Plate no.</label>
          <input className="input uppercase" value={c.plate ?? ''} onChange={(e) => set('plate', e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className="label">Bike model</label>
          <select className="input" value={c.bikeModel ?? ''} onChange={(e) => set('bikeModel', e.target.value || undefined)}>
            <option value="">—</option>
            {settings.bikeModels.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Credit limit (KES, 0 = none)</label>
          <input
            className="input"
            type="number"
            min={0}
            value={(c.creditLimit ?? 0) / 100}
            onChange={(e) => set('creditLimit', Math.round(Number(e.target.value) * 100))}
          />
        </div>
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input" rows={2} value={c.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" onClick={save} disabled={!c.name?.trim()}>
          Save customer
        </button>
      </div>
    </div>
  )
}

export default function CustomerPicker({ onPick, onClose }: { onPick: (c: Customer | undefined) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const customers = useLiveQuery(async () => {
    const term = q.trim().toLowerCase()
    const all = await db.customers.orderBy('name').toArray()
    return term
      ? all.filter((c) => [c.name, c.phone, c.plate].some((v) => v?.toLowerCase().replace(/\s/g, '').includes(term.replace(/\s/g, ''))))
      : all.slice(0, 50)
  }, [q])

  return (
    <Modal title={creating ? 'New customer' : 'Attach customer'} onClose={onClose}>
      {creating ? (
        <CustomerForm initial={{ name: q }} onSaved={onPick} onCancel={() => setCreating(false)} />
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input className="input pl-9" placeholder="Name, phone or plate" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </div>
            <button className="btn-dark" onClick={() => setCreating(true)}>
              <Plus size={16} /> New
            </button>
          </div>
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {customers?.map((c) => (
              <button key={c.id} onClick={() => onPick(c)} className="flex w-full items-center justify-between px-2 py-2 text-left hover:bg-slate-50">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-slate-500">{[c.phone, c.plate, c.bikeModel].filter(Boolean).join(' · ')}</div>
                </div>
                {c.balance > 0 && <span className="text-xs font-semibold text-red-600">owes {money(c.balance)}</span>}
              </button>
            ))}
          </div>
          <button className="btn-ghost mt-3 w-full" onClick={() => onPick(undefined)}>
            Walk-in (no customer)
          </button>
        </>
      )}
    </Modal>
  )
}
