// Stock take by scanning: pick a part, scan every item of it on the shelf.
// Each scanned label is registered to the part with its own barcode, and the
// part's stock becomes the number counted. Used to bring stock and labels back
// in line (e.g. after labels were lost from the till but are still on items).

import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Barcode, Check, Minus, Plus, ScanLine, Search, X } from 'lucide-react'
import { db } from '../db/db'
import { logActivity } from '../db/logs'
import { checkStockTakeScan, nextProductBarcode, stockTakeByScan } from '../db/units'
import type { Product, StockUnit } from '../db/types'
import { useSession } from '../session'
import { useSettings } from '../db/settings'
import { labelJobs, printLabels } from '../lib/printReceipt'
import { Badge, Modal, PageHeader, errorText, useToast } from '../components/ui'
import { DEFAULT_BRAND, nextNumber } from '../lib/partCodes'
import { toCents } from '../lib/money'

interface Scan {
  serial: string
  known: boolean
}

export default function StockTakePage() {
  const toast = useToast()
  const { user } = useSession()
  const settings = useSettings()
  const products = useLiveQuery(() => db.products.filter((p) => p.trackStock).sortBy('name'), [], [] as Product[])
  const shelf = useLiveQuery(() => db.units.where('status').equals('in_stock').toArray(), [], [] as StockUnit[])
  const counted = useLiveQuery(
    async () => {
      const since = new Date().setHours(0, 0, 0, 0)
      const moves = await db.movements.where('at').aboveOrEqual(since).filter((m) => m.note?.startsWith('Stock take by scan') ?? false).toArray()
      return new Set(moves.map((m) => m.productId))
    },
    [],
    new Set<number>(),
  )
  const labels = useMemo(() => {
    const m = new Map<number, number>()
    for (const u of shelf) m.set(u.productId, (m.get(u.productId) ?? 0) + 1)
    return m
  }, [shelf])

  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [scans, setScans] = useState<Scan[]>([])
  const [code, setCode] = useState('')
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [noLabel, setNoLabel] = useState(0)
  const total = scans.length + noLabel
  const input = useRef<HTMLInputElement>(null)

  const list = products.filter((p) => {
    const t = q.trim().toLowerCase()
    return !t || [p.name, p.sku, p.partNumber, p.barcode].some((v) => v?.toLowerCase().includes(t))
  })

  const pick = (p: Product) => {
    if (scans.length && !confirm(`Discard the ${scans.length} scans for ${selected?.name}?`)) return
    setSelected(p)
    setScans([])
    setNoLabel(0)
    setFlash(null)
    setTimeout(() => input.current?.focus(), 50)
  }

  const onScan = async (e: FormEvent) => {
    e.preventDefault()
    const serial = code.trim()
    setCode('')
    if (!serial || !selected) return
    if (scans.some((s) => s.serial === serial)) return setFlash({ ok: false, text: `${serial} — already scanned` })
    const why = await checkStockTakeScan(selected.id!, serial)
    if (why) return setFlash({ ok: false, text: `${serial} — ${why}` })
    const unit = await db.units.where('serial').equals(serial).first()
    const known = unit?.status === 'in_stock' && unit.productId === selected.id
    setScans((x) => [{ serial, known }, ...x])
    setFlash({ ok: true, text: `${serial} — ${known ? 'already registered' : 'added'}` })
  }

  const save = async () => {
    if (!selected) return
    const missing = (labels.get(selected.id!) ?? 0) - scans.filter((s) => s.known).length
    const msg =
      `Set ${selected.name} stock to ${total} (now ${selected.stock}).` +
      (noLabel > 0 ? `\n\n${noLabel} new barcode label${noLabel === 1 ? '' : 's'} will be made${settings.autoPrintLabels ? ' and printed' : ''} for the items with no label.` : '') +
      (missing > 0 ? `\n\n${missing} label${missing === 1 ? '' : 's'} registered to this part ${missing === 1 ? 'was' : 'were'} not scanned and will be cancelled.` : '')
    if (!confirm(msg)) return
    setBusy(true)
    try {
      const r = await stockTakeByScan(selected.id!, scans.map((s) => s.serial), user?.id, noLabel)
      await logActivity('stock', `Stock take: ${selected.name}`, {
        detail: `${r.before} → ${r.after} · ${r.added.length} labels added${r.created.length ? ` · ${r.created.length} new labels` : ''}${r.cancelled.length ? ` · ${r.cancelled.length} cancelled` : ''}`,
        userId: user?.id,
        userName: user?.name,
      })
      toast(`${selected.name}: stock ${r.before} → ${r.after} · ${r.added.length} label${r.added.length === 1 ? '' : 's'} registered${r.created.length ? ` · ${r.created.length} new` : ''}`)
      if (r.created.length) {
        // Print the new labels; the count is already saved even if printing fails.
        try {
          const product = (await db.products.get(selected.id!)) ?? selected
          const outcome = await printLabels(labelJobs(product, r.created), settings)
          if (outcome === 'blocked') toast('Allow popups to print the new labels — or reprint them from Inventory → Labels', 'error')
        } catch (e) {
          toast(`New labels did not print: ${errorText(e)}. Reprint them from Inventory → Labels.`, 'error')
        }
      }
      setScans([])
      setNoLabel(0)
      setSelected(null)
      setFlash(null)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const done = products.filter((p) => counted.has(p.id!)).length
  const [adding, setAdding] = useState(false)

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageHeader
        title="Stock take"
        subtitle={`Pick a part, scan every item of it on the shelf, save. ${done} of ${products.length} parts counted today.`}
        actions={
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add missing part
          </button>
        }
      />
      {adding && (
        <QuickPart
          onClose={() => setAdding(false)}
          onCreated={(p) => {
            setAdding(false)
            setQ('')
            pick(p)
          }}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="overflow-hidden rounded-xl border border-hairline bg-white">
          <div className="border-b border-hairline p-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="Find a part — name, SKU, part number…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="max-h-[65vh] divide-y divide-hairline overflow-y-auto">
            {list.map((p) => {
              const l = labels.get(p.id!) ?? 0
              return (
                <button
                  key={p.id}
                  onClick={() => pick(p)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 ${selected?.id === p.id ? 'bg-brand-50' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      SKU {p.sku} · stock {p.stock} · {l} label{l === 1 ? '' : 's'}
                    </div>
                  </div>
                  {counted.has(p.id!) ? (
                    <Badge tone="green">Counted</Badge>
                  ) : l !== p.stock ? (
                    <Badge tone="amber">{l < p.stock ? `${p.stock - l} unlabelled` : 'Check'}</Badge>
                  ) : null}
                </button>
              )
            })}
            {list.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No parts match.</p>}
          </div>
        </section>

        <section className="rounded-xl border border-hairline bg-white p-4">
          {!selected ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center text-slate-500">
              <ScanLine size={36} className="text-slate-300" />
              <p className="text-sm">Choose a part on the left, then scan the barcode on every item of it.</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-slate-900">{selected.name}</h2>
                  <p className="text-xs text-slate-500">
                    SKU {selected.sku} · system stock {selected.stock} · {labels.get(selected.id!) ?? 0} labels registered
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-extrabold leading-none text-brand-700">{total}</div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">counted</div>
                </div>
              </div>

              <form onSubmit={onScan} className="mb-2 flex gap-2">
                <div className="relative flex-1">
                  <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={input}
                    className="input pl-9 font-mono text-base"
                    data-scan="allow"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Scan a label…"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <button className="btn-ghost" type="submit">
                  Add
                </button>
              </form>
              {flash && (
                <p className={`mb-3 rounded-lg px-3 py-2 text-sm font-medium ${flash.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{flash.text}</p>
              )}

              <div className="max-h-[45vh] divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
                {scans.map((s, i) => (
                  <div key={s.serial} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-8 text-right text-xs text-slate-400">{scans.length - i}</span>
                    <span className="font-mono font-semibold">{s.serial}</span>
                    <span className="text-xs text-slate-500">{s.known ? 'already registered' : 'new'}</span>
                    <button className="ml-auto p-1 text-slate-400 hover:text-red-600" title="Remove" onClick={() => setScans((x) => x.filter((y) => y.serial !== s.serial))}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
                {scans.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Nothing scanned yet.</p>}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-hairline bg-slate-50 px-3 py-2.5">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold text-slate-800">Items with no barcode</div>
                  <div className="text-xs text-slate-500">New labels are made{settings.autoPrintLabels ? ' and printed' : ''} for them when you save.</div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="btn-ghost px-2" aria-label="One less" onClick={() => setNoLabel((n) => Math.max(0, n - 1))}>
                    <Minus size={15} />
                  </button>
                  <input
                    className="input w-16 text-center"
                    type="number"
                    min={0}
                    max={5000}
                    value={noLabel}
                    onChange={(e) => setNoLabel(Math.min(5000, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
                  />
                  <button type="button" className="btn-ghost px-2" aria-label="One more" onClick={() => setNoLabel((n) => Math.min(5000, n + 1))}>
                    <Plus size={15} />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button className="btn-ghost" disabled={busy} onClick={() => (scans.length && !confirm('Discard these scans?') ? null : (setSelected(null), setScans([]), setNoLabel(0), setFlash(null)))}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy} onClick={() => void save()}>
                  <Check size={16} /> Save count: {total} in stock{noLabel > 0 && settings.autoPrintLabels ? ` · print ${noLabel}` : ''}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** A part that was lost: enter its details, then scan the labels already on its items. */
function QuickPart({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Product) => void }) {
  const toast = useToast()
  const { user } = useSession()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [brand, setBrand] = useState(DEFAULT_BRAND)
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return toast('Enter the part name', 'error')
    if (toCents(price) <= 0) return toast('Enter the selling price', 'error')
    setBusy(true)
    try {
      const all = await db.products.toArray()
      const clash = all.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())
      if (clash && !confirm(`${clash.name} (SKU ${clash.sku}) already exists. Add another part with the same name?`)) return
      const now = Date.now()
      const product: Product = {
        sku: nextNumber(all.map((p) => p.sku)),
        partNumber: nextNumber(all.map((p) => p.partNumber)),
        name: name.trim(),
        barcode: await nextProductBarcode(),
        brand: brand.trim() || undefined,
        location: location.trim() || undefined,
        fitment: [],
        cost: Math.max(0, toCents(cost)),
        price: toCents(price),
        stock: 0, // set by the stock take when the labels are scanned
        reorderLevel: 2,
        taxable: true,
        serialized: false,
        trackStock: true,
        active: true,
        createdAt: now,
        updatedAt: now,
      }
      const id = (await db.products.add(product)) as number
      await logActivity('stock', `Part added: ${product.name}`, { detail: `SKU ${product.sku} · from stock take`, userId: user?.id, userName: user?.name })
      toast(`${product.name} added (SKU ${product.sku}) — now scan its labels`)
      onCreated({ ...product, id })
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add a missing part"
      onClose={onClose}
      footer={
        <button className="btn-primary" form="quick-part" disabled={busy}>
          <ScanLine size={16} /> Add & scan its labels
        </button>
      }
    >
      <form id="quick-part" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm text-slate-600 sm:col-span-2">
          For a part that is on the shelf with its barcode labels but missing from the system. SKU and part number are numbered automatically; stock comes from the
          labels you scan next. Edit anything else later in Inventory.
        </p>
        <div className="sm:col-span-2">
          <label className="label">Name *</label>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Selling price *</label>
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label className="label">Cost price</label>
          <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div>
          <label className="label">Brand</label>
          <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div>
          <label className="label">Bin / shelf location</label>
          <input className="input" placeholder="e.g. A3-02" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </form>
    </Modal>
  )
}
