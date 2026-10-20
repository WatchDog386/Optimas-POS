import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { PackageCheck, Plus, Trash2, Wand2 } from 'lucide-react'
import { db } from '../db/db'
import { createPurchaseOrder, draftReorder, receivePurchaseOrder } from '../db/purchasing'
import type { Product, PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus, Supplier } from '../db/types'
import { money, toCents } from '../lib/money'
import { useSession } from '../session'
import { Badge, Empty, ListPanel, Modal, PageHeader, Segmented, errorText, useToast } from '../components/ui'

const TONE: Record<PurchaseOrderStatus, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  draft: 'slate',
  ordered: 'blue',
  partial: 'amber',
  received: 'green',
  cancelled: 'red',
}

const poTotal = (po: PurchaseOrder) => po.lines.reduce((s, l) => s + l.qty * l.unitCost, 0)

export default function PurchasingPage() {
  const toast = useToast()
  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders')
  const [open, setOpen] = useState<PurchaseOrder | 'new' | null>(null)
  const [supplier, setSupplier] = useState<Partial<Supplier> | null>(null)
  const orders = useLiveQuery(() => db.purchaseOrders.orderBy('createdAt').reverse().toArray(), [], [])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [])
  const supName = Object.fromEntries(suppliers.map((s) => [s.id, s.name]))

  const reorder = async () => {
    const po = await draftReorder()
    if (!po) return toast('Nothing is below its reorder level 👍')
    toast(`Drafted ${po.poNo} with ${po.lines.length} lines`)
    setOpen(po)
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Purchasing"
        subtitle="Reorder from suppliers and receive deliveries into stock"
        actions={
          tab === 'orders' ? (
            <>
              <button className="btn-ghost" onClick={reorder}>
                <Wand2 size={16} /> Auto-reorder low stock
              </button>
              <button className="btn-primary" onClick={() => setOpen('new')}>
                <Plus size={16} /> New purchase order
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => setSupplier({})}>
              <Plus size={16} /> New supplier
            </button>
          )
        }
      />
      <div className="mb-3">
        <Segmented
          dark
          options={{ orders: 'Purchase orders', suppliers: 'Suppliers' }}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'orders' ? (
        <ListPanel title="Purchase orders" footer={<span>{orders.length} order{orders.length === 1 ? '' : 's'}</span>}>
          <table className="w-full">
            <thead className="table-head">
              <tr>
                <th>PO</th>
                <th>Supplier</th>
                <th>Created</th>
                <th>Lines</th>
                <th>Status</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id} className="table-row cursor-pointer" onClick={() => setOpen(po)}>
                  <td className="font-mono font-semibold">{po.poNo}</td>
                  <td>{supName[po.supplierId ?? -1] ?? '—'}</td>
                  <td>{new Date(po.createdAt).toLocaleDateString('en-KE')}</td>
                  <td>{po.lines.length}</td>
                  <td>
                    <Badge tone={TONE[po.status]}>{po.status}</Badge>
                  </td>
                  <td className="text-right font-semibold">{money(poTotal(po), '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <Empty>No purchase orders yet. Try “Auto-reorder low stock”.</Empty>}
        </ListPanel>
      ) : (
        <ListPanel title="Suppliers" footer={<span>{suppliers.length} supplier{suppliers.length === 1 ? '' : 's'}</span>}>
          <table className="w-full">
            <thead className="table-head">
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="table-row cursor-pointer" onClick={() => setSupplier(s)}>
                  <td className="font-semibold">{s.name}</td>
                  <td>{s.phone}</td>
                  <td>{s.email}</td>
                  <td className="text-slate-500">{s.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListPanel>
      )}

      {open && <PurchaseOrderModal po={open === 'new' ? undefined : open} suppliers={suppliers} onClose={() => setOpen(null)} />}
      {supplier && <SupplierModal supplier={supplier} onClose={() => setSupplier(null)} />}
    </div>
  )
}

function SupplierModal({ supplier, onClose }: { supplier: Partial<Supplier>; onClose: () => void }) {
  const [s, setS] = useState(supplier)
  const save = async () => {
    if (!s.name?.trim()) return
    const rec = { ...s, name: s.name.trim() } as Supplier
    if (rec.id === undefined) delete rec.id
    await db.suppliers.put(rec)
    onClose()
  }
  return (
    <Modal title={s.id ? 'Edit supplier' : 'New supplier'} onClose={onClose} footer={<button className="btn-primary" onClick={save}>Save</button>}>
      <div className="space-y-3">
        {(['name', 'phone', 'email', 'notes'] as const).map((k) => (
          <div key={k}>
            <label className="label">{k}</label>
            <input className="input" value={s[k] ?? ''} onChange={(e) => setS((x) => ({ ...x, [k]: e.target.value }))} />
          </div>
        ))}
      </div>
    </Modal>
  )
}

function PurchaseOrderModal({ po, suppliers, onClose }: { po?: PurchaseOrder; suppliers: Supplier[]; onClose: () => void }) {
  const { user } = useSession()
  const toast = useToast()
  const products = useLiveQuery(() => db.products.filter((p) => p.trackStock).sortBy('name'), [], [] as Product[])
  const byId = Object.fromEntries(products.map((p) => [p.id, p]))
  const [supplierId, setSupplierId] = useState(po?.supplierId)
  const [lines, setLines] = useState<PurchaseOrderLine[]>(po?.lines ?? [])
  const [notes, setNotes] = useState(po?.notes ?? '')
  const [receive, setReceive] = useState<Record<number, number>>({})
  const [pick, setPick] = useState('')
  const editable = !po || po.status === 'draft'
  const receivable = po && ['ordered', 'partial', 'draft'].includes(po.status)

  const addLine = () => {
    const p = products.find((x) => String(x.id) === pick)
    if (!p || lines.some((l) => l.productId === p.id)) return
    setLines((ls) => [...ls, { productId: p.id!, qty: Math.max(1, p.reorderLevel * 2 - p.stock), unitCost: p.cost, received: 0 }])
    setPick('')
  }

  const save = async (status: PurchaseOrderStatus) => {
    try {
      if (lines.length === 0) throw new Error('Add at least one part')
      if (po) await db.purchaseOrders.update(po.id!, { supplierId, lines, notes, status, updatedAt: Date.now() })
      else {
        const created = await createPurchaseOrder(lines, supplierId, notes)
        if (status !== 'draft') await db.purchaseOrders.update(created.id!, { status })
      }
      toast(status === 'ordered' ? 'Marked as ordered' : 'Saved')
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const doReceive = async () => {
    try {
      if (po!.status === 'draft') await db.purchaseOrders.update(po!.id!, { lines })
      await receivePurchaseOrder(po!.id!, receive, user?.id)
      toast('Stock received')
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)

  return (
    <Modal
      title={po ? `Purchase order ${po.poNo}` : 'New purchase order'}
      onClose={onClose}
      wide
      footer={
        <>
          {po && po.status !== 'received' && po.status !== 'cancelled' && (
            <button className="btn-ghost mr-auto text-red-600" onClick={() => save('cancelled')}>
              Cancel PO
            </button>
          )}
          {editable && (
            <>
              <button className="btn-ghost" onClick={() => save('draft')}>
                Save draft
              </button>
              <button className="btn-dark" onClick={() => save('ordered')}>
                Mark as ordered
              </button>
            </>
          )}
          {receivable && (
            <button className="btn-primary" onClick={doReceive} disabled={!Object.values(receive).some((v) => v > 0)}>
              <PackageCheck size={16} /> Receive into stock
            </button>
          )}
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">Supplier</label>
          <select className="input" value={supplierId ?? ''} disabled={!editable} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <table className="w-full">
        <thead className="table-head">
          <tr>
            <th>Part</th>
            <th>In stock</th>
            <th>Order qty</th>
            <th>Unit cost (KES)</th>
            <th>Received</th>
            {receivable && <th>Receive now</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const p = byId[l.productId]
            const outstanding = l.qty - l.received
            return (
              <tr key={l.productId} className="table-row">
                <td>
                  <div className="font-semibold">{p?.name ?? 'Deleted part'}</div>
                  <div className="font-mono text-xs text-slate-500">{p?.sku}</div>
                </td>
                <td>{p?.stock}</td>
                <td>
                  <input className="input w-20" type="number" min={1} disabled={!editable} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
                </td>
                <td>
                  <input
                    className="input w-28"
                    inputMode="decimal"
                    disabled={!editable && !receivable}
                    defaultValue={l.unitCost / 100}
                    onBlur={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitCost: toCents(e.target.value) } : x)))}
                  />
                </td>
                <td>{l.received}</td>
                {receivable && (
                  <td>
                    <div className="flex items-center gap-1">
                      <input
                        className="input w-20"
                        type="number"
                        min={0}
                        max={outstanding}
                        value={receive[i] ?? ''}
                        onChange={(e) => setReceive((r) => ({ ...r, [i]: Math.max(0, Number(e.target.value)) }))}
                      />
                      {outstanding > 0 && (
                        <button className="text-xs font-semibold text-brand-700" onClick={() => setReceive((r) => ({ ...r, [i]: outstanding }))}>
                          all
                        </button>
                      )}
                    </div>
                  </td>
                )}
                <td>
                  {editable && (
                    <button className="text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {editable && (
        <div className="mt-3 flex gap-2">
          <select className="input flex-1" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add a part…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}) — {p.stock} in stock
              </option>
            ))}
          </select>
          <button className="btn-dark" onClick={addLine} disabled={!pick}>
            <Plus size={16} /> Add
          </button>
        </div>
      )}
      <p className="mt-3 text-right text-lg font-bold">Order value {money(total)}</p>
    </Modal>
  )
}
