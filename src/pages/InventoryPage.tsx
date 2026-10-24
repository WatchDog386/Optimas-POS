import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { Bike, Download, History, Package, Pencil, Plus, Printer, Search, SlidersHorizontal, Tag, Upload } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { adjustStock } from '../db/sales'
import type { Product } from '../db/types'
import { money, toCents } from '../lib/money'
import { download, parseCsv, toCsv } from '../lib/csv'
import { printBarcodeLabel } from '../lib/printReceipt'
import { useSession } from '../session'
import { Badge, Empty, ListPanel, Modal, PageHeader, errorText, useToast } from '../components/ui'
import { quotationImportSummary, quotationProductSkus } from '../db/quotationProducts'

const CSV_HEADER = ['sku', 'name', 'barcode', 'partNumber', 'category', 'brand', 'fitment', 'cost', 'price', 'stock', 'reorderLevel', 'location', 'taxable', 'serialized', 'trackStock']

export default function InventoryPage() {
  const [searchParams] = useSearchParams()
  const settings = useSettings()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const [cat, setCat] = useState<number | 'all'>('all')
  const [lowOnly, setLowOnly] = useState(false)
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [history, setHistory] = useState<Product | null>(null)

  useEffect(() => {
    setQ(searchParams.get('q') ?? '')
    const view = searchParams.get('view')
    if (view === 'compatibility') {
      // Could add a compatibility view in the future
    } else if (view === 'adjustments') {
      // Could add stock adjustments view in the future
    } else if (view === 'lowstock') {
      setLowOnly(true)
    }
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
  const quoteProducts = products.filter((product) => quotationProductSkus.has(product.sku))
  const quoteSetupCount = quoteProducts.filter((product) => !product.barcode || product.price <= 0 || !product.active).length

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
            <button className="btn-primary" onClick={() => setEditing({})}>
              <Plus size={16} /> New part
            </button>
          </>
        }
      />
      {quoteProducts.length > 0 && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <div className="font-semibold">Quotation {quotationImportSummary.reference}: {quoteProducts.length} parts in the catalog</div>
          <p className="mt-1 text-blue-800">
            {quoteSetupCount} still need barcode, selling price, or activation. The quoted {quotationImportSummary.requestedUnits} units are not counted as on-hand stock; record a receipt after availability is confirmed.
          </p>
        </div>
      )}
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
              const quotationPart = quotationProductSkus.has(p.sku)
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
                  <td className="text-xs">{p.fitment.length ? p.fitment.join(', ') : <span className="text-slate-400">{quotationPart ? 'Fitment unconfirmed' : 'Universal'}</span>}</td>
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
                    {p.barcode && (
                      <button
                        className="p-1.5 text-slate-500 hover:text-brand-600"
                        title="Print barcode label"
                        onClick={() => {
                          void printBarcodeLabel(p, settings).then((ok) => {
                            if (!ok) toast('No barcode printer configured — set one in Settings', 'error')
                          })
                        }}
                      >
                        <Printer size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No parts found.</Empty>}
      </ListPanel>

      {editing && <ProductForm initial={editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustModal product={adjusting} onClose={() => setAdjusting(null)} />}
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
  const imageRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((x) => ({ ...x, [k]: v }))
  const isNew = p.id === undefined

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
    try {
      if (!p.sku?.trim() || !p.name?.trim()) throw new Error('SKU and name are required')
      if (p.active && toCents(price) <= 0) throw new Error('Set a selling price above zero before activating this part')
      if (p.active && quotationProductSkus.has(p.sku.trim())) {
        if (!p.barcode?.trim()) throw new Error('Add the barcode before activating this quoted part')
        if (p.trackStock !== false && (p.stock ?? 0) <= 0) throw new Error('Receive stock before activating this quoted part')
      }
      const clash = await db.products.where('sku').equals(p.sku.trim()).first()
      if (clash && clash.id !== p.id) throw new Error(`SKU ${p.sku} is already used by ${clash.name}`)
      let barcode = p.barcode?.trim()
      if (isNew && !barcode) barcode = p.sku.trim() // auto-generate a barcode from the SKU so it can be printed & scanned at sale
      if (barcode) {
        const bc = await db.products.where('barcode').equals(barcode).first()
        if (bc && bc.id !== p.id) throw new Error(`Barcode already used by ${bc.name}`)
      }
      let categoryId = p.categoryId
      if (newCat.trim()) categoryId = (await db.categories.add({ name: newCat.trim(), color: '#64748b' })) as number
      const now = Date.now()
      const record = {
        ...p,
        sku: p.sku.trim(),
        name: p.name.trim(),
        barcode: barcode || undefined,
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
      <Section icon={Package} title="Part details" hint={isNew ? 'New part' : 'Editing'}>
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
