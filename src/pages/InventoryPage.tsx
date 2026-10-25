import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_BRAND, nextNumber } from '../lib/partCodes'
import type { ComponentType, ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { Barcode, Bike, Download, History, Package, Pencil, Plus, Printer, Search, SlidersHorizontal, Tag, Trash2, Upload } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { adjustStock } from '../db/sales'
import type { Product, StockUnit } from '../db/types'
import { money, toCents } from '../lib/money'
import { download, parseCsv, toCsv } from '../lib/csv'
import { labelJobs, printLabels } from '../lib/printReceipt'
import { cancelSurplusUnits, createUnits, nextProductBarcode, unlabelledCount, writeOffUnits } from '../db/units'
import { logActivity } from '../db/logs'
import { useSession } from '../session'
import { Badge, Empty, ListPanel, Modal, PageHeader, errorText, useToast } from '../components/ui'

const CSV_HEADER = ['sku', 'name', 'barcode', 'partNumber', 'category', 'brand', 'fitment', 'cost', 'price', 'stock', 'reorderLevel', 'location', 'taxable', 'serialized', 'trackStock']

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const settings = useSettings()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const [cat, setCat] = useState<number | 'all'>('all')
  const [lowOnly, setLowOnly] = useState(false)
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [history, setHistory] = useState<Product | null>(null)
  const [labelling, setLabelling] = useState<Product | null>(null)
  const { user, can } = useSession()

  useEffect(() => {
    setQ(searchParams.get('q') ?? '')
    setLowOnly(searchParams.get('view') === 'lowstock')
    if (searchParams.get('new') === '1') {
      setEditing({})
    }
  }, [searchParams])

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
  const inactiveCount = products.filter((p) => !p.active).length

  const exportCsv = () => {
    const data = products.map((p) => [
      p.sku, p.name, p.barcode, p.partNumber, catName[p.categoryId ?? -1], p.brand, p.fitment.join('|'),
      p.cost / 100, p.price / 100, p.stock, p.reorderLevel, p.location, p.taxable ? 1 : 0, p.serialized ? 1 : 0, p.trackStock ? 1 : 0,
    ])
    download(`products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([CSV_HEADER, ...data]))
  }

  const clearAllInventory = async () => {
    const typed = prompt(
      `This deletes ALL ${products.length} parts, their stock history and serial labels from this till. Sales receipts are kept.\n\nType DELETE to confirm.`,
    )
    if (typed?.trim() !== 'DELETE') return
    await db.transaction('rw', [db.products, db.movements, db.units], async () => {
      await db.products.clear()
      await db.movements.clear()
      await db.units.clear()
    })
    await logActivity('stock', 'Inventory cleared', { detail: `${products.length} parts removed`, userId: user?.id, userName: user?.name })
    toast('All parts deleted from inventory')
    setQ('')
    setCat('all')
    setLowOnly(false)
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
      await db.transaction('rw', [db.products, db.categories, db.movements], async () => {
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
            brand: get(r, 'brand') || prev?.brand || DEFAULT_BRAND,
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
          const id = (await db.products.put(p)) as number
          // Stock only ever changes through movements (they are what syncs between tills).
          const delta = p.trackStock ? p.stock - (prev?.trackStock ? prev.stock : 0) : 0
          if (delta !== 0) await db.movements.add({ productId: id, change: delta, reason: 'count', note: 'CSV import', userId: user?.id, at: now })
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
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Inventory"
        subtitle={`${products.length} parts · ${inactiveCount} inactive · stock value ${money(stockValue, settings.currency)} at cost · ${lowCount} low on stock`}
        actions={
          <>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> Import CSV
            </button>
            <button className="btn-ghost" onClick={exportCsv}>
              <Download size={16} /> Export
            </button>
            {can('users') && products.length > 0 && (
              <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => void clearAllInventory()}>
                <Trash2 size={16} /> Clear all
              </button>
            )}
            <button className="btn-primary" onClick={() => setEditing({})}>
              <Plus size={16} /> New part
            </button>
          </>
        }
      />
      {/* Mobile: search + category dropdown + low-stock toggle (replaces the dark bar and toolbar) */}
      <div className="mb-3 flex items-center gap-2 sm:hidden">
        <input
          className="input h-9 min-w-0 flex-1 text-sm"
          data-scan="allow"
          placeholder="Search name, SKU…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input h-9 w-32 shrink-0 border-0 bg-slate-100 text-sm text-slate-600 shadow-none"
          value={cat === 'all' ? 'all' : String(cat)}
          onChange={(e) => setCat(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          aria-label="Category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low
        </label>
      </div>
      <ListPanel
        title="Parts inventory"
        barClassName="hidden sm:flex"
        toolbarClassName="hidden sm:flex"
        actions={
          <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10">
            {rows.length} / {products.length}
          </span>
        }
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input w-44 border-0 bg-white py-1.5 text-sm shadow-none"
                value={cat}
                onChange={(e) => setCat(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
              </label>
            </div>
            <div className="relative w-80 max-w-full">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                className="input border-0 bg-white pl-9 text-sm shadow-none"
                data-scan="allow"
                placeholder="Search name, SKU, barcode…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </>
        }
        footer={
          <>
            <span>
              Stock value at cost <strong>{money(stockValue, settings.currency)}</strong>
            </span>
            <span className="text-xs text-slate-500">{lowCount} low on stock</span>
          </>
        }
      >
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
                <tr key={p.id} className="table-row">
                  <td className="font-mono text-xs">{p.sku}</td>
                  <td>
                    <div className="font-semibold">{p.name}</div>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                      {[catName[p.categoryId ?? -1], p.partNumber && `P/N ${p.partNumber}`, p.barcode].filter(Boolean).join(' · ')}
                      {!p.active && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600" title="Not available on the cashier screen until activated">
                          Draft · not for sale
                        </span>
                      )}
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
                    <button className="p-1.5 text-slate-500 hover:text-brand-600" title="Barcode labels" onClick={() => setLabelling(p)}>
                      <Barcode size={16} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <Empty>
            {products.length === 0 ? (
              <span className="flex flex-col items-center gap-3">
                <span>No parts yet. Add your first part — its serial barcode labels print automatically from the opening stock.</span>
                <button className="btn-primary" onClick={() => setEditing({})}>
                  <Plus size={16} /> New part
                </button>
              </span>
            ) : (
              'No parts found.'
            )}
          </Empty>
        )}
      </ListPanel>

      {editing && (
        <ProductForm
          initial={editing}
          onClose={() => {
            setEditing(null)
            // Drop ?new=1 so F3 / "Add part" opens the form again next time.
            if (searchParams.has('new')) {
              const next = new URLSearchParams(searchParams)
              next.delete('new')
              setSearchParams(next, { replace: true })
            }
          }}
          onLabels={(prod) => setLabelling(prod)}
        />
      )}
      {adjusting && <AdjustModal product={adjusting} onClose={() => setAdjusting(null)} />}
      {labelling && <LabelsModal product={labelling} onClose={() => setLabelling(null)} />}
      {history && <HistoryModal product={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

/** Panel used to group the part form — mirrors the ListPanel chrome exactly. */
function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-none border border-hairline bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-ink px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
          <Icon size={16} className="shrink-0 text-brand-400" />
          {title}
        </h3>
        {hint && <span className="text-xs font-semibold text-white/60">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function ProductForm({ initial, onClose, onLabels }: { initial: Partial<Product>; onClose: () => void; onLabels: (p: Product) => void }) {
  const settings = useSettings()
  const toast = useToast()
  const { user } = useSession()
  const [saving, setSaving] = useState(false)
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
    ...(initial.id === undefined ? { brand: DEFAULT_BRAND } : {}),
    ...initial,
  })
  // New parts: SKU and part number are numbered 0001, 0002, …
  const [autoCodes, setAutoCodes] = useState<{ sku?: string; partNumber?: string }>({})
  const suggestCodes = async () => {
    const all = await db.products.toArray()
    return { sku: nextNumber(all.map((x) => x.sku)), partNumber: nextNumber(all.map((x) => x.partNumber)) }
  }
  useEffect(() => {
    if (initial.id !== undefined) return
    void suggestCodes().then((codes) => {
      setAutoCodes(codes)
      setP((x) => ({ ...x, sku: x.sku || codes.sku, partNumber: x.partNumber || codes.partNumber }))
    })
    // Once, when the form opens.
  }, [])
  const [cost, setCost] = useState(String((p.cost ?? 0) / 100))
  const [price, setPrice] = useState(String((p.price ?? 0) / 100))
  const [newCat, setNewCat] = useState('')
  const imageRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((x) => ({ ...x, [k]: v }))
  const isNew = p.id === undefined
  // Editing: the stock box can be changed; the difference to the live stock is logged on save.
  const liveStock = useLiveQuery(async () => (p.id === undefined ? undefined : (await db.products.get(p.id))?.stock), [p.id])
  const [stockTouched, setStockTouched] = useState(false)
  const stockNow = liveStock ?? initial.stock ?? 0
  const stockDelta = !isNew && stockTouched && p.trackStock !== false ? Math.floor(Number(p.stock) || 0) - stockNow : 0

  const onImage = (file?: File) => {
    if (!file) return
    if (file.size > 1_500_000) {
      toast('Image too large — use a photo under ~1.5 MB', 'error')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('image', String(reader.result))
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      if (!p.sku?.trim() || !p.name?.trim()) throw new Error('SKU and name are required')
      if (p.active && toCents(price) <= 0 && p.trackStock !== false) throw new Error('Set a selling price above zero before activating this part')
      if (toCents(cost) < 0 || toCents(price) < 0) throw new Error('Prices cannot be negative')
      const opening = isNew && p.trackStock !== false ? Math.max(0, Math.floor(Number(p.stock) || 0)) : 0
      if (opening > 5000) throw new Error('Opening stock above 5,000 — enter it in batches')
      let sku = p.sku.trim().toUpperCase()
      // Another till may have taken the suggested code meanwhile — move to the next one.
      if (isNew && sku === autoCodes.sku && (await db.products.where('sku').equals(sku).first())) sku = (await suggestCodes()).sku
      const clash = await db.products.where('sku').equals(sku).first()
      if (clash && clash.id !== p.id) throw new Error(`SKU ${sku} is already used by ${clash.name}`)
      let barcode = p.barcode?.trim()
      // No manufacturer barcode: give the part an in-store EAN-13 so it scans everywhere.
      if (!barcode) barcode = await nextProductBarcode()
      const bc = await db.products.where('barcode').equals(barcode).first()
      if (bc && bc.id !== p.id) throw new Error(`Barcode already used by ${bc.name}`)
      if (await db.units.where('serial').equals(barcode).first()) throw new Error('That barcode is already a serial label on another item')
      let categoryId = p.categoryId
      if (newCat.trim()) {
        const existing = await db.categories.where('name').equalsIgnoreCase(newCat.trim()).first()
        categoryId = existing?.id ?? ((await db.categories.add({ name: newCat.trim(), color: '#64748b' })) as number)
      }
      const now = Date.now()
      const record = {
        ...p,
        sku,
        name: p.name.trim(),
        barcode,
        categoryId,
        cost: toCents(cost),
        price: toCents(price),
        stock: isNew ? opening : p.stock ?? 0,
        reorderLevel: Math.max(0, Math.floor(Number(p.reorderLevel) || 0)),
        createdAt: p.createdAt ?? now,
        updatedAt: now,
      } as Product
      if (record.id === undefined) delete record.id

      // Save the part, log the opening stock and give every unit its own serial label — atomically.
      const { id, units, cancelled } = await db.transaction('rw', [db.products, db.movements, db.units, db.kv], async () => {
        let id: number
        if (isNew) id = (await db.products.add(record)) as number
        else {
          // Never write back the stock count from when the form opened — sales may
          // have happened since. Stock only changes through logged movements.
          const { id: existingId, stock: _stock, createdAt: _created, ...changes } = record
          void _stock
          void _created
          id = existingId!
          await db.products.update(id, changes)
        }
        let units: StockUnit[] = []
        let cancelled: string[] = []
        if (!isNew && stockTouched && record.trackStock !== false) {
          // Compare with the stock right now (sales may have happened while the form was open).
          const target = Math.max(0, Math.floor(Number(p.stock) || 0))
          const current = (await db.products.get(id))?.stock ?? 0
          const delta = target - current
          if (delta > 5000) throw new Error('Adding more than 5,000 units — enter it in batches')
          if (delta !== 0) {
            await db.products.update(id, { stock: target, updatedAt: now })
            await db.movements.add({ productId: id, change: delta, reason: 'count', note: `Stock edited ${current} → ${target}`, userId: user?.id, at: now })
            if (delta > 0) units = await createUnits(id, delta, 'Stock edited')
          }
          // Never leave more labels on the shelf than units in stock.
          cancelled = await cancelSurplusUnits(id, target)
        }
        if (opening > 0) {
          await db.movements.add({ productId: id, change: opening, reason: 'count', note: 'Opening stock', userId: user?.id, at: now })
          units = await createUnits(id, opening, 'Opening stock')
        }
        return { id, units, cancelled }
      })
      const saved = (await db.products.get(id)) ?? { ...record, id }
      await logActivity('stock', `${isNew ? 'Part added' : 'Part updated'}: ${saved.name}`, {
        detail: opening
          ? `${opening} opening stock · ${units.length} serial labels`
          : [saved.sku, units.length && `+${units.length} labels`, cancelled.length && `${cancelled.length} labels cancelled`].filter(Boolean).join(' · '),
        userId: user?.id,
        userName: user?.name,
      })

      if (units.length && settings.autoPrintLabels) {
        try {
          const outcome = await printLabels(labelJobs(saved, units), settings)
          if (outcome === 'blocked') toast('Part saved. Allow popups to print labels, then use the label button on the part.', 'error')
          else toast(`${isNew ? 'Part added' : 'Part updated'} · ${units.length} ${isNew ? '' : 'new '}label${units.length === 1 ? '' : 's'} sent to the printer`)
        } catch (e) {
          toast(`Part saved, but labels did not print: ${errorText(e)}. Reprint from the label button.`, 'error')
        }
      } else if (cancelled.length) {
        const list = cancelled.length <= 6 ? `: ${cancelled.join(', ')}` : ` (newest first, e.g. ${cancelled.slice(-3).join(', ')})`
        toast(`Part updated · ${cancelled.length} label${cancelled.length === 1 ? '' : 's'} cancelled${list}. Peel those off — they will no longer scan.`)
      } else {
        toast(isNew ? (units.length ? `Part added with ${units.length} serial labels` : 'Part added') : units.length ? `Part updated with ${units.length} new labels` : 'Part updated')
      }
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  /** Delete a part that was never sold; parts with sales history are deactivated instead. */
  const remove = async () => {
    if (!p.id) return
    const sold = await db.sales.filter((sale) => sale.lines.some((l) => l.productId === p.id)).first()
    if (sold) {
      if (!p.active) return toast(`${p.name} has sales history, so it stays in the records — it is already inactive`, 'error')
      if (!confirm(`${p.name} appears on receipt ${sold.receiptNo}, so it can't be deleted without breaking your sales records.\n\nMark it inactive instead? It disappears from the sell screens but stays in reports.`)) return
      await db.products.update(p.id, { active: false, updatedAt: Date.now() })
      await logActivity('stock', `Part deactivated: ${p.name}`, { detail: p.sku, userId: user?.id, userName: user?.name })
      toast(`${p.name} is now inactive`)
      return onClose()
    }
    if (!confirm(`Delete ${p.name} (${p.sku}) for good? Its stock history and serial labels are deleted too, on every till.`)) return
    await db.transaction('rw', [db.products, db.movements, db.units], async () => {
      await db.movements.where('productId').equals(p.id!).delete()
      await db.units.where('productId').equals(p.id!).delete()
      await db.products.delete(p.id!)
    })
    await logActivity('stock', `Part deleted: ${p.name}`, { detail: p.sku, userId: user?.id, userName: user?.name })
    toast(`${p.name} deleted`)
    onClose()
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
          {!isNew && (
            <>
              <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => void remove()} disabled={saving}>
                <Trash2 size={16} /> Delete
              </button>
              <button className="btn-ghost mr-auto" onClick={() => onLabels(p as Product)}>
                <Printer size={16} /> Labels
              </button>
            </>
          )}
          <button className="btn-primary" onClick={save} disabled={saving}>
            {isNew && p.trackStock !== false && (p.stock ?? 0) > 0 && settings.autoPrintLabels ? (
              <>
                <Printer size={16} /> Save & print {p.stock} label{p.stock === 1 ? '' : 's'}
              </>
            ) : stockDelta > 0 && settings.autoPrintLabels ? (
              <>
                <Printer size={16} /> Save & print {stockDelta} label{stockDelta === 1 ? '' : 's'}
              </>
            ) : stockDelta < 0 ? (
              `Save & cancel ${-stockDelta} label${stockDelta === -1 ? '' : 's'}`
            ) : (
              'Save part'
            )}
          </button>
        </>
      }
    >
      <Section icon={Package} title="Part details" hint={isNew ? 'New part' : 'Editing'}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="label">Name *</label>
            <input className="input" value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">SKU *</label>
            <input className="input font-mono uppercase" value={p.sku ?? ''} onChange={(e) => set('sku', e.target.value.toUpperCase())} />
            {isNew && p.sku && p.sku === autoCodes.sku && <span className="text-[10px] text-slate-500">Numbered automatically.</span>}
          </div>
          <div>
            <label className="label">Product barcode</label>
            <input className="input font-mono" data-scan="allow" placeholder="Scan the box barcode, or leave blank" value={p.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} />
            <span className="text-[10px] text-slate-500">Blank = an in-store EAN-13 is generated. Each unit also gets its own serial label.</span>
          </div>
          <div>
            <label className="label">OEM / part number</label>
            <input className="input font-mono uppercase" value={p.partNumber ?? ''} onChange={(e) => set('partNumber', e.target.value.toUpperCase())} />
            {isNew && p.partNumber && p.partNumber === autoCodes.partNumber && <span className="text-[10px] text-slate-500">Numbered automatically.</span>}
          </div>
          <div>
            <label className="label">Brand</label>
            <input className="input" value={p.brand ?? ''} placeholder={DEFAULT_BRAND} onChange={(e) => set('brand', e.target.value)} />
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
            <label className="label">
              Supplier <span className="font-normal normal-case text-slate-400">(optional)</span>
            </label>
            <select className="input" value={p.supplierId ?? ''} onChange={(e) => set('supplierId', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">None</option>
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
          <div className="md:col-span-3">
            <label className="label">Product photo</label>
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onImage(e.target.files?.[0])}
            />
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-hairline bg-mist p-3 transition hover:border-brand-400">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-hairline bg-white">
                {p.image ? (
                  <img src={p.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-300">
                    <Package size={20} />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => imageRef.current?.click()}>
                  Upload image
                </button>
                {p.image && (
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:text-red-700"
                    onClick={() => set('image', undefined)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <span className="ml-auto hidden text-[11px] font-medium text-ink-faint sm:block">JPG or PNG · under 1.5 MB</span>
            </div>
          </div>
        </div>
      </Section>

      <Section
        icon={Tag}
        title="Pricing & stock"
        hint={settings.pricesIncludeVat ? 'KES · selling price incl. VAT' : 'KES'}
      >
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="label">Cost price</label>
            <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div>
            <label className="label">Selling price</label>
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="label">{isNew ? 'Opening stock' : 'Stock on hand'}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={!isNew && !stockTouched ? stockNow : (p.stock ?? 0)}
              disabled={p.trackStock === false}
              onChange={(e) => {
                setStockTouched(true)
                set('stock', Math.max(0, Math.floor(Number(e.target.value) || 0)))
              }}
            />
            {isNew && p.trackStock !== false && (
              <span className="text-[10px] text-slate-500">One serial barcode label per unit is generated{settings.autoPrintLabels ? ' and printed' : ''}.</span>
            )}
            {!isNew && p.trackStock !== false && (
              <span className={`text-[10px] ${stockDelta > 0 ? 'text-emerald-700' : stockDelta < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                {stockDelta > 0
                  ? `+${stockDelta} — ${stockDelta} new serial label${stockDelta === 1 ? '' : 's'} ${settings.autoPrintLabels ? 'will print' : 'will be created'}.`
                  : stockDelta < 0
                    ? `${stockDelta} — the ${-stockDelta} newest label${stockDelta === -1 ? '' : 's'} will be cancelled and stop scanning.`
                    : `Now ${stockNow}. Change it to add (prints labels) or remove stock.`}
              </span>
            )}
          </div>
          <div>
            <label className="label">Reorder at</label>
            <input className="input" type="number" min={0} value={p.reorderLevel ?? 0} onChange={(e) => set('reorderLevel', Number(e.target.value))} />
          </div>
        </div>
      </Section>

      <Section icon={Bike} title="Bike fitment" hint="Leave empty for universal parts">
        <div className="flex flex-wrap gap-2">
          {settings.bikeModels.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggleFit(m)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition duration-150 ${
                p.fitment!.includes(m)
                  ? 'border-brand-500 bg-brand-500 text-white shadow-[0_4px_10px_-4px_rgba(44,130,134,0.6)]'
                  : 'border-hairline bg-white text-slate-600 hover:border-brand-500/60 hover:text-brand-600'
              }`}
            >
              {m}
            </button>
          ))}
          {settings.bikeModels.length === 0 && (
            <span className="text-sm text-ink-faint">No bike models configured yet — add them in Settings.</span>
          )}
        </div>
      </Section>

      <Section icon={SlidersHorizontal} title="Options">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(
            [
              ['taxable', 'VAT applies'],
              ['trackStock', 'Track stock'],
              ['serialized', 'Ask for serial no. (batteries, controllers, motors)'],
              ['active', 'Active (shown on Sell screen)'],
            ] as const
          ).map(([k, label]) => (
            <label
              key={k}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-hairline bg-white px-3 py-2.5 transition duration-150 hover:border-brand-400 hover:bg-brand-50/50"
            >
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-cta" checked={p[k]} onChange={(e) => set(k, e.target.checked)} />
              <span className="text-sm font-medium leading-snug text-ink-body">{label}</span>
            </label>
          ))}
        </div>
      </Section>
    </Modal>
  )
}

function AdjustModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { user } = useSession()
  const settings = useSettings()
  const toast = useToast()
  const [mode, setMode] = useState<'count' | 'adjust' | 'damage'>('count')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const units = useLiveQuery(
    () => db.units.where('productId').equals(product.id!).filter((u) => u.status === 'in_stock').sortBy('createdAt'),
    [product.id],
    [] as StockUnit[],
  )
  const n = Math.floor(Number(value) || 0)
  // Writing off labelled units: the scanned/ticked labels decide the quantity.
  const damageQty = mode === 'damage' && picked.length > 0 ? picked.length : Math.abs(n)
  const change = mode === 'count' ? n - product.stock : mode === 'damage' ? -damageQty : n

  const save = async () => {
    if (change === 0 || saving) return onClose()
    setSaving(true)
    try {
      const created = await adjustStock(product.id!, change, mode, user?.id, note || undefined, undefined, change > 0)
      if (mode === 'damage' && picked.length) await writeOffUnits(picked)
      const cancelled = change < 0 ? await cancelSurplusUnits(product.id!, product.stock + change) : []
      toast(`Stock ${change > 0 ? '+' : ''}${change} → ${product.stock + change}${cancelled.length ? ` · ${cancelled.length} label${cancelled.length === 1 ? '' : 's'} cancelled` : ''}`)
      if (created.length && settings.autoPrintLabels) {
        try {
          const outcome = await printLabels(labelJobs(product, created), settings)
          if (outcome === 'blocked') toast('Allow popups to print the new labels', 'error')
        } catch (e) {
          toast(`Labels did not print: ${errorText(e)}`, 'error')
        }
      }
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
      setSaving(false)
    }
  }

  const togglePick = (serial: string) => setPicked((x) => (x.includes(serial) ? x.filter((s) => s !== serial) : [...x, serial]))

  return (
    <Modal
      title={`Adjust stock · ${product.name}`}
      onClose={onClose}
      footer={
        <button className="btn-primary" onClick={save} disabled={saving}>
          {change > 0 && settings.autoPrintLabels ? `Save & print ${change} label${change === 1 ? '' : 's'}` : 'Save'}
        </button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Current stock: <b>{product.stock}</b> · {units.length} labelled unit{units.length === 1 ? '' : 's'} on the shelf
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
      {mode === 'damage' && units.length > 0 ? (
        <>
          <label className="label">Tick (or scan) the labels being written off</label>
          <input
            className="input mb-2 font-mono"
            data-scan="allow"
            placeholder="Scan a serial label…"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const v = e.currentTarget.value.trim()
              if (units.some((u) => u.serial === v)) setPicked((x) => (x.includes(v) ? x : [...x, v]))
              else toast(`${v} is not an in-stock label of this part`, 'error')
              e.currentTarget.value = ''
            }}
          />
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-hairline bg-white p-2">
            {units.map((u) => (
              <label key={u.id} className="flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" checked={picked.includes(u.serial)} onChange={() => togglePick(u.serial)} /> {u.serial}
                <span className="font-sans text-slate-400">{u.source}</span>
              </label>
            ))}
          </div>
          {picked.length === 0 && (
            <>
              <label className="label mt-3">…or quantity written off (unlabelled items)</label>
              <input className="input text-lg" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
            </>
          )}
        </>
      ) : (
        <>
          <label className="label">{mode === 'count' ? 'Counted quantity on shelf' : mode === 'damage' ? 'Quantity written off' : 'Change (use − to remove)'}</label>
          <input className="input text-lg" type="number" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </>
      )}
      <p className="mt-2 text-sm">
        New stock: <b>{product.stock + change}</b> ({change >= 0 ? '+' : ''}
        {change}){change > 0 && product.trackStock && <span className="text-slate-500"> · {change} new serial label{change === 1 ? '' : 's'}</span>}
      </p>
      <label className="label mt-3">Note</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier delivery, cracked in storage" />
    </Modal>
  )
}

/** Every physical unit of a part with its own barcode — print, reprint and fill gaps. */
function LabelsModal({ product: initial, onClose }: { product: Product; onClose: () => void }) {
  const settings = useSettings()
  const toast = useToast()
  const { user } = useSession()
  const product = useLiveQuery(() => db.products.get(initial.id!), [initial.id], initial) ?? initial
  const units = useLiveQuery(() => db.units.where('productId').equals(initial.id!).sortBy('createdAt'), [initial.id], [] as StockUnit[])
  const missing = useLiveQuery(() => unlabelledCount(product), [product], 0)
  const inStock = units.filter((u) => u.status === 'in_stock')
  const sold = units.filter((u) => u.status === 'sold')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [shelfCopies, setShelfCopies] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPicked(new Set(inStock.map((u) => u.id!)))
  }, [inStock.length])

  const run = async (jobs: Parameters<typeof printLabels>[0], what: string) => {
    setBusy(true)
    try {
      const outcome = await printLabels(jobs, settings)
      if (outcome === 'blocked') toast('Allow popups for this site to print labels', 'error')
      else toast(`${jobs.length} ${what} sent to the printer`)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const fillGaps = async () => {
    setBusy(true)
    try {
      const created = await createUnits(product.id!, missing, 'Labelled existing stock')
      await logActivity('stock', `Serial labels created: ${product.name}`, { detail: `${created.length} units`, userId: user?.id, userName: user?.name })
      setBusy(false)
      await run(labelJobs(product, created), 'labels')
    } catch (e) {
      toast(errorText(e), 'error')
      setBusy(false)
    }
  }

  const selected = inStock.filter((u) => picked.has(u.id!))

  return (
    <Modal
      title={`Barcode labels · ${product.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto self-center text-xs text-slate-500">
            {settings.labelWidthMm}×{settings.labelHeightMm} mm · {settings.labelLanguage.toUpperCase()} · change in Settings → Hardware
          </span>
          <button className="btn-primary" disabled={busy || selected.length === 0} onClick={() => run(labelJobs(product, selected), 'labels')}>
            <Printer size={16} /> Print {selected.length} serial label{selected.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      {missing > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <b>{missing}</b> of the {product.stock} on hand have no serial label yet.
          </span>
          <button className="btn-dark" disabled={busy} onClick={() => void fillGaps()}>
            <Barcode size={16} /> Create & print {missing}
          </button>
        </div>
      )}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">On the shelf ({inStock.length})</h3>
        {inStock.length > 0 && (
          <button
            className="text-xs font-semibold text-brand-600"
            onClick={() => setPicked(picked.size === inStock.length ? new Set() : new Set(inStock.map((u) => u.id!)))}
          >
            {picked.size === inStock.length ? 'Select none' : 'Select all'}
          </button>
        )}
      </div>
      <div className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {inStock.map((u) => (
          <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-hairline bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="accent-cta"
              checked={picked.has(u.id!)}
              onChange={() =>
                setPicked((x) => {
                  const next = new Set(x)
                  if (next.has(u.id!)) next.delete(u.id!)
                  else next.add(u.id!)
                  return next
                })
              }
            />
            <span className="font-mono font-semibold">{u.serial}</span>
            <span className="ml-auto truncate text-xs text-slate-400">{u.source}</span>
          </label>
        ))}
        {inStock.length === 0 && <p className="text-sm text-slate-500">No labelled units on the shelf.</p>}
      </div>
      {sold.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          {sold.length} labelled unit{sold.length === 1 ? '' : 's'} sold — last on {sold[sold.length - 1].receiptNo}.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-hairline pt-4">
        <div>
          <label className="label">Shelf / bin labels (product barcode {product.barcode || product.sku})</label>
          <input className="input w-28" type="number" min={1} max={200} value={shelfCopies} onChange={(e) => setShelfCopies(Math.min(200, Math.max(1, Math.floor(Number(e.target.value) || 1))))} />
        </div>
        <button className="btn-ghost" disabled={busy} onClick={() => run(labelJobs(product, undefined, shelfCopies), 'shelf labels')}>
          <Printer size={16} /> Print shelf label{shelfCopies === 1 ? '' : 's'}
        </button>
      </div>
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
