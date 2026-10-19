import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, History, Pencil, Plus, Search, SlidersHorizontal, Upload } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { adjustStock } from '../db/sales'
import type { Product } from '../db/types'
import { money, toCents } from '../lib/money'
import { download, parseCsv, toCsv } from '../lib/csv'
import { useSession } from '../session'
import { Badge, Empty, Modal, PageHeader, errorText, useToast } from '../components/ui'

const CSV_HEADER = ['sku', 'name', 'barcode', 'partNumber', 'category', 'brand', 'fitment', 'cost', 'price', 'stock', 'reorderLevel', 'location', 'taxable', 'serialized', 'trackStock']

export default function InventoryPage() {
  const settings = useSettings()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<number | 'all'>('all')
  const [lowOnly, setLowOnly] = useState(false)
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [history, setHistory] = useState<Product | null>(null)

  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [], [] as Product[])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]))

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return products
      .filter((p) => cat === 'all' || p.categoryId === cat)
      .filter((p) => !lowOnly || (p.trackStock && p.stock <= p.reorderLevel))
      .filter((p) => !t || [p.name, p.sku, p.barcode, p.partNumber, p.brand, ...p.fitment].some((v) => v?.toLowerCase().includes(t)))
  }, [products, q, cat, lowOnly])

  const stockValue = products.filter((p) => p.trackStock && p.stock > 0).reduce((s, p) => s + p.stock * p.cost, 0)
  const lowCount = products.filter((p) => p.active && p.trackStock && p.stock <= p.reorderLevel).length

  const exportCsv = () => {
    const data = products.map((p) => [
      p.sku, p.name, p.barcode, p.partNumber, catName[p.categoryId ?? -1], p.brand, p.fitment.join('|'),
      p.cost / 100, p.price / 100, p.stock, p.reorderLevel, p.location, p.taxable ? 1 : 0, p.serialized ? 1 : 0, p.trackStock ? 1 : 0,
    ])
    download(`products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([CSV_HEADER, ...data]))
  }

  const importCsv = async (file: File) => {
    try {
      const [header, ...lines] = parseCsv(await file.text())
      const idx = (k: string) => header.findIndex((h) => h.trim().toLowerCase() === k.toLowerCase())
      if (idx('sku') < 0 || idx('name') < 0) throw new Error('CSV needs at least "sku" and "name" columns')
      const get = (r: string[], k: string) => (idx(k) >= 0 ? r[idx(k)]?.trim() : undefined)
      const flag = (v: string | undefined, dflt: boolean) => (v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'y'].includes(v.toLowerCase()))
      let added = 0
      let updated = 0
      await db.transaction('rw', db.products, db.categories, async () => {
        for (const r of lines) {
          const sku = get(r, 'sku')
          if (!sku) continue
          const catLabel = get(r, 'category')
          let categoryId: number | undefined
          if (catLabel) {
            const existing = await db.categories.where('name').equalsIgnoreCase(catLabel).first()
            categoryId = existing?.id ?? ((await db.categories.add({ name: catLabel, color: '#64748b' })) as number)
          }
          const prev = await db.products.where('sku').equals(sku).first()
          const now = Date.now()
          const num = (k: string) => (get(r, k) ? Number(get(r, k)) : undefined)
          const p: Product = {
            ...prev,
            sku,
            name: get(r, 'name') || prev?.name || sku,
            barcode: get(r, 'barcode') || prev?.barcode,
            partNumber: get(r, 'partNumber') || prev?.partNumber,
            brand: get(r, 'brand') || prev?.brand,
            categoryId: categoryId ?? prev?.categoryId,
            fitment: get(r, 'fitment') ? get(r, 'fitment')!.split('|').map((s) => s.trim()).filter(Boolean) : prev?.fitment ?? [],
            cost: num('cost') !== undefined ? toCents(num('cost')!) : prev?.cost ?? 0,
            price: num('price') !== undefined ? toCents(num('price')!) : prev?.price ?? 0,
            stock: num('stock') ?? prev?.stock ?? 0,
            reorderLevel: num('reorderLevel') ?? prev?.reorderLevel ?? 0,
            location: get(r, 'location') || prev?.location,
            taxable: flag(get(r, 'taxable'), prev?.taxable ?? true),
            serialized: flag(get(r, 'serialized'), prev?.serialized ?? false),
            trackStock: flag(get(r, 'trackStock'), prev?.trackStock ?? true),
            active: prev?.active ?? true,
            createdAt: prev?.createdAt ?? now,
            updatedAt: now,
          }
          await db.products.put(p)
          if (prev) updated++
          else added++
        }
      })
      toast(`Imported: ${added} new, ${updated} updated`)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Inventory"
        subtitle={`${products.length} parts · stock value ${money(stockValue, settings.currency)} at cost · ${lowCount} low on stock`}
        actions={
          <>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> Import CSV
            </button>
            <button className="btn-ghost" onClick={exportCsv}>
              <Download size={16} /> Export
            </button>
            <button className="btn-primary" onClick={() => setEditing({})}>
              <Plus size={16} /> New part
            </button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input className="input pl-9" data-scan="allow" placeholder="Search name, SKU, barcode, part no., bike" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-48" value={cat} onChange={(e) => setCat(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
        </label>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="table-head">
            <tr>
              <th>SKU</th>
              <th>Part</th>
              <th>Fits</th>
              <th>Bin</th>
              <th className="text-right">Stock</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Price</th>
              <th className="text-right">Margin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const margin = p.price ? Math.round(((p.price - p.cost) / p.price) * 100) : 0
              return (
                <tr key={p.id} className={`table-row ${p.active ? '' : 'opacity-50'}`}>
                  <td className="font-mono text-xs">{p.sku}</td>
                  <td>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {[catName[p.categoryId ?? -1], p.partNumber && `P/N ${p.partNumber}`, p.barcode].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="text-xs">{p.fitment.length ? p.fitment.join(', ') : <span className="text-slate-400">Universal</span>}</td>
                  <td className="text-xs">{p.location}</td>
                  <td className="text-right">
                    {p.trackStock ? <Badge tone={p.stock <= 0 ? 'red' : p.stock <= p.reorderLevel ? 'amber' : 'green'}>{p.stock}</Badge> : '—'}
                  </td>
                  <td className="text-right">{money(p.cost, '')}</td>
                  <td className="text-right font-semibold">{money(p.price, '')}</td>
                  <td className="text-right text-xs">{margin}%</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="p-1.5 text-slate-500 hover:text-slate-900" title="Edit" onClick={() => setEditing(p)}>
                      <Pencil size={16} />
                    </button>
                    {p.trackStock && (
                      <button className="p-1.5 text-slate-500 hover:text-slate-900" title="Adjust stock" onClick={() => setAdjusting(p)}>
                        <SlidersHorizontal size={16} />
                      </button>
                    )}
                    <button className="p-1.5 text-slate-500 hover:text-slate-900" title="Stock history" onClick={() => setHistory(p)}>
                      <History size={16} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No parts found.</Empty>}
      </div>

      {editing && <ProductForm initial={editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustModal product={adjusting} onClose={() => setAdjusting(null)} />}
      {history && <HistoryModal product={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

function ProductForm({ initial, onClose }: { initial: Partial<Product>; onClose: () => void }) {
  const settings = useSettings()
  const toast = useToast()
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [])
  const [p, setP] = useState<Partial<Product>>({
    fitment: [],
    cost: 0,
    price: 0,
    stock: 0,
    reorderLevel: 2,
    taxable: true,
    serialized: false,
    trackStock: true,
    active: true,
    ...initial,
  })
  const [cost, setCost] = useState(String((p.cost ?? 0) / 100))
  const [price, setPrice] = useState(String((p.price ?? 0) / 100))
  const [newCat, setNewCat] = useState('')
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((x) => ({ ...x, [k]: v }))
  const isNew = p.id === undefined

  const save = async () => {
    try {
      if (!p.sku?.trim() || !p.name?.trim()) throw new Error('SKU and name are required')
      const clash = await db.products.where('sku').equals(p.sku.trim()).first()
      if (clash && clash.id !== p.id) throw new Error(`SKU ${p.sku} is already used by ${clash.name}`)
      if (p.barcode) {
        const bc = await db.products.where('barcode').equals(p.barcode.trim()).first()
        if (bc && bc.id !== p.id) throw new Error(`Barcode already used by ${bc.name}`)
      }
      let categoryId = p.categoryId
      if (newCat.trim()) categoryId = (await db.categories.add({ name: newCat.trim(), color: '#64748b' })) as number
      const now = Date.now()
      const record = {
        ...p,
        sku: p.sku.trim(),
        name: p.name.trim(),
        barcode: p.barcode?.trim() || undefined,
        categoryId,
        cost: toCents(cost),
        price: toCents(price),
        createdAt: p.createdAt ?? now,
        updatedAt: now,
      } as Product
      if (record.id === undefined) delete record.id
      await db.products.put(record)
      toast(isNew ? 'Part added' : 'Part updated')
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const toggleFit = (m: string) => set('fitment', p.fitment!.includes(m) ? p.fitment!.filter((x) => x !== m) : [...p.fitment!, m])

  return (
    <Modal
      title={isNew ? 'New part' : `Edit ${p.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save part
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="label">Name *</label>
          <input className="input" value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">SKU *</label>
          <input className="input font-mono uppercase" value={p.sku ?? ''} onChange={(e) => set('sku', e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className="label">Barcode</label>
          <input className="input font-mono" data-scan="allow" placeholder="Scan the box" value={p.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} />
        </div>
        <div>
          <label className="label">OEM / part number</label>
          <input className="input font-mono" value={p.partNumber ?? ''} onChange={(e) => set('partNumber', e.target.value)} />
        </div>
        <div>
          <label className="label">Brand</label>
          <input className="input" value={p.brand ?? ''} onChange={(e) => set('brand', e.target.value)} />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={p.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input className="input mt-1" placeholder="…or new category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
        </div>
        <div>
          <label className="label">Supplier</label>
          <select className="input" value={p.supplierId ?? ''} onChange={(e) => set('supplierId', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Bin / shelf location</label>
          <input className="input" value={p.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="e.g. A3-02" />
        </div>
        <div>
          <label className="label">Cost price (KES)</label>
          <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div>
          <label className="label">Selling price (KES{settings.pricesIncludeVat ? ', incl. VAT' : ''})</label>
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">{isNew ? 'Opening stock' : 'Stock'}</label>
            <input
              className="input"
              type="number"
              value={p.stock ?? 0}
              disabled={!isNew}
              title={isNew ? '' : 'Use Adjust stock so the change is logged'}
              onChange={(e) => set('stock', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Reorder at</label>
            <input className="input" type="number" min={0} value={p.reorderLevel ?? 0} onChange={(e) => set('reorderLevel', Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="label">Fits bike models (leave empty for universal parts)</label>
        <div className="flex flex-wrap gap-2">
          {settings.bikeModels.map((m) => (
            <button
              key={m}
              onClick={() => toggleFit(m)}
              className={`rounded-full border px-3 py-1 text-sm ${p.fitment!.includes(m) ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-slate-300'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={p.taxable} onChange={(e) => set('taxable', e.target.checked)} /> VAT applies
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={p.trackStock} onChange={(e) => set('trackStock', e.target.checked)} /> Track stock
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={p.serialized} onChange={(e) => set('serialized', e.target.checked)} /> Ask for serial no. (batteries, controllers, motors)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={p.active} onChange={(e) => set('active', e.target.checked)} /> Active (shown on Sell screen)
        </label>
      </div>
    </Modal>
  )
}

function AdjustModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { user } = useSession()
  const toast = useToast()
  const [mode, setMode] = useState<'count' | 'adjust' | 'damage'>('count')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const n = Number(value) || 0
  const change = mode === 'count' ? n - product.stock : mode === 'damage' ? -Math.abs(n) : n

  const save = async () => {
    if (change === 0) return onClose()
    await adjustStock(product.id!, change, mode, user?.id, note || undefined)
    toast(`Stock ${change > 0 ? '+' : ''}${change} → ${product.stock + change}`)
    onClose()
  }

  return (
    <Modal title={`Adjust stock · ${product.name}`} onClose={onClose} footer={<button className="btn-primary" onClick={save}>Save</button>}>
      <p className="mb-3 text-sm text-slate-600">
        Current stock: <b>{product.stock}</b>
      </p>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(
          [
            ['count', 'Stock count'],
            ['adjust', 'Add / remove'],
            ['damage', 'Damaged / lost'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={mode === m ? 'btn-dark' : 'btn-ghost'} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      <label className="label">{mode === 'count' ? 'Counted quantity on shelf' : mode === 'damage' ? 'Quantity written off' : 'Change (use − to remove)'}</label>
      <input className="input text-lg" type="number" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <p className="mt-2 text-sm">
        New stock: <b>{product.stock + change}</b> ({change >= 0 ? '+' : ''}
        {change})
      </p>
      <label className="label mt-3">Note</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  )
}

function HistoryModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const moves = useLiveQuery(() => db.movements.where('productId').equals(product.id!).reverse().sortBy('at'), [product.id], [])
  return (
    <Modal title={`Stock history · ${product.name}`} onClose={onClose}>
      <table className="w-full">
        <thead className="table-head">
          <tr>
            <th>When</th>
            <th>Reason</th>
            <th>Ref</th>
            <th className="text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => (
            <tr key={m.id} className="table-row">
              <td className="text-xs">{new Date(m.at).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className="capitalize">
                {m.reason}
                {m.note && <div className="text-xs text-slate-500">{m.note}</div>}
              </td>
              <td className="font-mono text-xs">{m.reference}</td>
              <td className={`text-right font-semibold ${m.change < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {m.change > 0 ? '+' : ''}
                {m.change}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {moves.length === 0 && <Empty>No movements yet.</Empty>}
    </Modal>
  )
}
