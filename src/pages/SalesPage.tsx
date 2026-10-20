import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { RotateCcw, Search } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { refundSale } from '../db/sales'
import type { PaymentMethod, Sale } from '../db/types'
import { money } from '../lib/money'
import { useSession } from '../session'
import { Badge, Empty, ListPanel, Modal, PageHeader, Segmented, errorText, useToast } from '../components/ui'
import ReceiptModal from '../components/ReceiptModal'

const RANGES = { today: 'Today', week: 'Last 7 days', month: 'Last 30 days', all: 'All time' } as const
type Range = keyof typeof RANGES

export function rangeStart(r: Range): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (r === 'today') return d.getTime()
  if (r === 'week') return d.getTime() - 6 * 86400000
  if (r === 'month') return d.getTime() - 29 * 86400000
  return 0
}

const STATUS_TONE = { completed: 'green', refunded: 'red', partially_refunded: 'amber', voided: 'slate' } as const

export default function SalesPage() {
  const settings = useSettings()
  const { can } = useSession()
  const [range, setRange] = useState<Range>('today')
  const [q, setQ] = useState('')
  const [view, setView] = useState<Sale | null>(null)
  const [refund, setRefund] = useState<Sale | null>(null)

  const sales = useLiveQuery(
    () => db.sales.where('createdAt').aboveOrEqual(rangeStart(range)).reverse().sortBy('createdAt'),
    [range],
    [] as Sale[],
  )
  const customers = useLiveQuery(() => db.customers.toArray(), [], [])
  const users = useLiveQuery(() => db.users.toArray(), [], [])
  const custName = Object.fromEntries(customers.map((c) => [c.id, c.name]))
  const userName = Object.fromEntries(users.map((u) => [u.id, u.name]))

  const term = q.trim().toLowerCase()
  const rows = term
    ? sales.filter(
        (s) =>
          s.receiptNo.toLowerCase().includes(term) ||
          custName[s.customerId ?? -1]?.toLowerCase().includes(term) ||
          s.payments.some((p) => p.reference?.toLowerCase().includes(term)) ||
          s.lines.some((l) => l.serial?.toLowerCase().includes(term)),
      )
    : sales

  const total = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Sales history"
        subtitle={`${rows.length} transactions · net ${money(total, settings.currency)}`}
      />
      {/* Mobile: search + range dropdown (replaces the dark bar and pills) */}
      <div className="mb-3 flex items-center gap-2 sm:hidden">
        <input
          className="input h-9 min-w-0 flex-1 text-sm"
          placeholder="Search receipt, customer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input h-9 w-32 shrink-0 border-0 bg-slate-100 text-sm text-slate-600 shadow-none"
          value={range}
          onChange={(e) => setRange(e.target.value as Range)}
          aria-label="Date range"
        >
          {Object.entries(RANGES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ListPanel
        title="Sales history"
        barClassName="hidden sm:flex"
        toolbarClassName="hidden sm:flex"
        actions={
          <Segmented dark options={RANGES} value={range} onChange={setRange} />
        }
        toolbar={
          <>
            <span className="text-xs font-medium text-slate-200">
              {rows.length} transaction{rows.length === 1 ? '' : 's'} · net {money(total, settings.currency)}
            </span>
            <div className="relative w-72 max-w-full">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                className="input border-0 bg-white pl-9 text-sm shadow-none"
                placeholder="Search receipt, customer, M-Pesa…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </>
        }
        footer={
          <>
            <span>
              Showing <strong>{rows.length}</strong> of {sales.length}
            </span>
            <span className="text-xs text-slate-500">Click a row for the receipt</span>
          </>
        }
      >
        <table className="w-full min-w-[820px]">
          <thead className="table-head">
            <tr>
              <th>Receipt</th>
              <th>Time</th>
              <th>Customer</th>
              <th>Cashier</th>
              <th>Payment</th>
              <th>Status</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="table-row cursor-pointer" onClick={() => setView(s)}>
                <td className="font-mono font-semibold">{s.receiptNo}</td>
                <td>{new Date(s.createdAt).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{custName[s.customerId ?? -1] ?? <span className="text-slate-400">Walk-in</span>}</td>
                <td>{userName[s.userId]}</td>
                <td className="capitalize">{[...new Set(s.payments.map((p) => (p.method === 'mpesa' ? 'M-Pesa' : p.method)))].join(' + ')}</td>
                <td>
                  {s.refundOf ? <Badge tone="red">refund</Badge> : <Badge tone={STATUS_TONE[s.status]}>{s.status.replace('_', ' ')}</Badge>}
                </td>
                <td className={`text-right font-semibold ${s.total < 0 ? 'text-red-600' : ''}`}>{money(s.total, '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No sales in this period.</Empty>}
      </ListPanel>

      {view && !refund && (
        <ReceiptModal
          sale={view}
          settings={settings}
          onClose={() => setView(null)}
          actions={
            can('refund') &&
            !view.refundOf &&
            view.status !== 'refunded' && (
              <button className="btn-danger mr-auto" onClick={() => setRefund(view)}>
                <RotateCcw size={16} /> Refund
              </button>
            )
          }
        />
      )}
      {refund && (
        <RefundModal
          sale={refund}
          onClose={() => setRefund(null)}
          onDone={(r) => {
            setRefund(null)
            setView(r)
          }}
        />
      )}
    </div>
  )
}

function RefundModal({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: (refund: Sale) => void }) {
  const { user, shift } = useSession()
  const toast = useToast()
  const [qty, setQty] = useState<Record<number, number>>(() =>
    Object.fromEntries(sale.lines.map((l, i) => [i, l.qty - (l.refundedQty ?? 0)])),
  )
  const [restock, setRestock] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>(sale.payments[0]?.method ?? 'cash')
  const [reason, setReason] = useState('')

  const submit = async () => {
    try {
      const r = await refundSale(sale.id!, { qtyByLine: qty, restock, method, userId: user!.id!, shiftId: shift?.id, reason })
      toast(`Refunded ${money(-r.total)}`)
      onDone(r)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <Modal title={`Refund ${sale.receiptNo}`} onClose={onClose} footer={<button className="btn-danger" onClick={submit}>Process refund</button>}>
      <table className="mb-4 w-full">
        <thead className="table-head">
          <tr>
            <th>Item</th>
            <th>Sold</th>
            <th>Refund qty</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l, i) => {
            const max = l.qty - (l.refundedQty ?? 0)
            return (
              <tr key={i} className="table-row">
                <td>
                  {l.name}
                  {l.serial && <div className="text-xs text-slate-500">S/N {l.serial}</div>}
                </td>
                <td>
                  {l.qty}
                  {l.refundedQty ? <span className="text-xs text-slate-500"> ({l.refundedQty} refunded)</span> : null}
                </td>
                <td>
                  <input
                    className="input w-20"
                    type="number"
                    min={0}
                    max={max}
                    value={qty[i] ?? 0}
                    disabled={max === 0}
                    onChange={(e) => setQty((x) => ({ ...x, [i]: Math.min(max, Math.max(0, Number(e.target.value))) }))}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Refund via</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa (reverse/send)</option>
            <option value="card">Card</option>
            {sale.customerId && <option value="account">Credit customer account</option>}
          </select>
        </div>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          Return items to stock
        </label>
      </div>
      <div className="mt-3">
        <label className="label">Reason</label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong part for bike model" />
      </div>
    </Modal>
  )
}
