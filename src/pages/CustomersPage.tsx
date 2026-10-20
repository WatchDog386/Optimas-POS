import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { HandCoins, Plus, Search } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { receiveAccountPayment } from '../db/sales'
import { addCashMovement } from '../db/shifts'
import type { Customer } from '../db/types'
import { money, toCents } from '../lib/money'
import { useSession } from '../session'
import { Badge, Empty, ListPanel, Modal, PageHeader, useToast } from '../components/ui'
import { CustomerForm } from '../components/CustomerPicker'

export default function CustomersPage() {
  const settings = useSettings()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Partial<Customer> | null>(null)
  const [view, setView] = useState<Customer | null>(null)
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), [], [])
  const t = q.trim().toLowerCase()
  const rows = t ? customers.filter((c) => [c.name, c.phone, c.plate, c.bikeModel].some((v) => v?.toLowerCase().includes(t))) : customers
  const owed = customers.reduce((s, c) => s + Math.max(0, c.balance), 0)

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} customers · ${money(owed, settings.currency)} owed on account`}
        actions={
          <button className="btn-primary" onClick={() => setEditing({})}>
            <Plus size={16} /> New customer
          </button>
        }
      />
      {/* Mobile: search (replaces the dark toolbar) */}
      <div className="mb-3 sm:hidden">
        <input
          className="input h-9 w-full text-sm"
          placeholder="Search name, phone, plate…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ListPanel
        title="Customers"
        barClassName="hidden sm:flex"
        toolbarClassName="hidden sm:flex"
        toolbar={
          <>
            <span className="text-xs font-medium text-slate-200">
              {rows.length} shown · {money(owed, settings.currency)} owed overall
            </span>
            <div className="relative w-72 max-w-full">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                className="input border-0 bg-white pl-9 text-sm shadow-none"
                placeholder="Search name, phone, plate…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </>
        }
        footer={
          <span>
            Showing <strong>{rows.length}</strong> of {customers.length}
          </span>
        }
      >
        <table className="w-full">
          <thead className="table-head">
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Bike</th>
              <th>Plate</th>
              <th className="text-right">Balance owed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="table-row cursor-pointer" onClick={() => setView(c)}>
                <td className="font-semibold">{c.name}</td>
                <td>{c.phone}</td>
                <td>{c.bikeModel}</td>
                <td className="font-mono text-xs">{c.plate}</td>
                <td className="text-right">{c.balance > 0 ? <Badge tone="red">{money(c.balance, '')}</Badge> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No customers found.</Empty>}
      </ListPanel>
      {editing && (
        <Modal title={editing.id ? 'Edit customer' : 'New customer'} onClose={() => setEditing(null)}>
          <CustomerForm initial={editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </Modal>
      )}
      {view && (
        <CustomerDetail
          id={view.id!}
          onClose={() => setView(null)}
          onEdit={(c) => {
            setView(null)
            setEditing(c)
          }}
        />
      )}
    </div>
  )
}

function CustomerDetail({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (c: Customer) => void }) {
  const settings = useSettings()
  const { shift } = useSession()
  const toast = useToast()
  const c = useLiveQuery(() => db.customers.get(id), [id])
  const sales = useLiveQuery(() => db.sales.where('customerId').equals(id).reverse().sortBy('createdAt'), [id], [])
  const [pay, setPay] = useState('')
  const [method, setMethod] = useState<'cash' | 'mpesa'>('mpesa')
  if (!c) return null
  const lifetime = sales.reduce((s, x) => s + x.total, 0)

  const receive = async () => {
    const amount = toCents(pay)
    if (amount <= 0) return
    await receiveAccountPayment(id, amount)
    if (method === 'cash' && shift) await addCashMovement(shift.id!, 'in', amount, `Account payment: ${c.name}`)
    toast(`Received ${money(amount)} from ${c.name}`)
    setPay('')
  }

  return (
    <Modal
      title={c.name}
      onClose={onClose}
      wide
      footer={
        <button className="btn-ghost" onClick={() => onEdit(c)}>
          Edit details
        </button>
      }
    >
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Stat label="Phone" value={c.phone ?? '—'} />
        <Stat label="Bike" value={[c.bikeModel, c.plate].filter(Boolean).join(' · ') || '—'} />
        <Stat label="Lifetime spend" value={money(lifetime, settings.currency)} />
        <Stat label="Owes" value={money(c.balance, settings.currency)} danger={c.balance > 0} />
      </div>
      {c.balance > 0 && (
        <div className="mb-4 flex items-end gap-2 rounded-xl bg-amber-50 p-3">
          <div className="flex-1">
            <label className="label">Receive account payment (KES)</label>
            <input className="input" inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} placeholder={String(c.balance / 100)} />
          </div>
          <select className="input w-32" value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'mpesa')}>
            <option value="mpesa">M-Pesa</option>
            <option value="cash">Cash</option>
          </select>
          <button className="btn-primary" onClick={receive}>
            <HandCoins size={16} /> Record
          </button>
        </div>
      )}
      {c.notes && <p className="mb-3 text-sm text-slate-600">{c.notes}</p>}
      <h3 className="mb-2 font-semibold">Purchase history</h3>
      <table className="w-full">
        <thead className="table-head">
          <tr>
            <th>Receipt</th>
            <th>Date</th>
            <th>Items</th>
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id} className="table-row">
              <td className="font-mono">{s.receiptNo}</td>
              <td>{new Date(s.createdAt).toLocaleDateString('en-KE')}</td>
              <td className="text-xs">{s.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td>
              <td className="text-right font-semibold">{money(s.total, '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sales.length === 0 && <Empty>No purchases yet.</Empty>}
    </Modal>
  )
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-semibold ${danger ? 'text-red-600' : ''}`}>{value}</div>
    </div>
  )
}
