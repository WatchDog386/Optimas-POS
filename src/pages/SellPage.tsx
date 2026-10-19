import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bike, Minus, PauseCircle, Percent, Plus, Search, ShoppingCart, Trash2, UserRound, Wrench, X } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { completeSale } from '../db/sales'
import { openShift } from '../db/shifts'
import type { Customer, ParkedSale, Product, Sale, SaleLine } from '../db/types'
import { computeTotals, lineTotal } from '../lib/cart'
import { money, moneyShort, toCents } from '../lib/money'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { useSession } from '../session'
import { Badge, Modal, errorText, useToast } from '../components/ui'
import PaymentModal from '../components/PaymentModal'
import ReceiptModal from '../components/ReceiptModal'
import CustomerPicker from '../components/CustomerPicker'

export const CART_KEY = 'optimas.cart'

interface CartState {
  lines: SaleLine[]
  discount: number
  customerId?: number
}

function loadCart(): CartState {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) ?? '') as CartState
  } catch {
    return { lines: [], discount: 0 }
  }
}

export function lineFromProduct(p: Product): SaleLine {
  return {
    productId: p.id,
    name: p.name,
    sku: p.sku,
    qty: 1,
    unitPrice: p.price,
    unitCost: p.cost,
    discount: 0,
    taxable: p.taxable,
  }
}

export function matchesSearch(p: Product, term: string): boolean {
  const t = term.toLowerCase()
  return [p.name, p.sku, p.barcode, p.partNumber, p.brand].some((v) => v?.toLowerCase().includes(t))
}

type Dialog = 'pay' | 'customer' | 'discount' | 'custom' | 'parked' | 'shift' | { line: number } | null

export default function SellPage() {
  const settings = useSettings()
  const { user, shift, can } = useSession()
  const toast = useToast()
  const searchRef = useRef<HTMLInputElement>(null)

  const [cart, setCart] = useState<CartState>(loadCart)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<number | 'all'>('all')
  const [bike, setBike] = useState<string>('all')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [receipt, setReceipt] = useState<Sale | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart))
    } catch {
      // Cart just won't survive a reload.
    }
  }, [cart])

  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), [], [] as Product[])
  const customer = useLiveQuery(() => (cart.customerId ? db.customers.get(cart.customerId) : undefined), [cart.customerId])
  const parkedCount = useLiveQuery(() => db.parked.count(), [], 0)

  const catColor = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.color])), [categories])

  const visible = useMemo(() => {
    const term = query.trim()
    return products
      .filter((p) => category === 'all' || p.categoryId === category)
      .filter((p) => bike === 'all' || p.fitment.length === 0 || p.fitment.includes(bike))
      .filter((p) => !term || matchesSearch(p, term))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, category, bike, query])

  const totals = computeTotals(cart.lines, cart.discount, settings.vatRate, settings.pricesIncludeVat)

  const addProduct = (p: Product) => {
    const inCart = cart.lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0)
    if (p.trackStock && p.stock - inCart <= 0) toast(`${p.name}: no stock recorded — sale will go negative`, 'error')
    setCart((c) => {
      // Serial-tracked items always get their own line so each serial can be captured.
      const idx = p.serialized ? -1 : c.lines.findIndex((l) => l.productId === p.id && !l.serial)
      if (idx >= 0) {
        const lines = c.lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l))
        return { ...c, lines }
      }
      return { ...c, lines: [...c.lines, lineFromProduct(p)] }
    })
    if (p.serialized) setTimeout(() => setDialog({ line: cart.lines.length }), 0)
  }

  const findExact = (code: string) => {
    const c = code.trim().toLowerCase()
    return products.find((p) => p.barcode?.toLowerCase() === c || p.sku.toLowerCase() === c || p.partNumber?.toLowerCase() === c)
  }

  useBarcodeScanner((code) => {
    const p = findExact(code)
    if (p) addProduct(p)
    else toast(`No product with barcode ${code}`, 'error')
  }, dialog === null && receipt === null)

  // Keyboard shortcuts, modelled on desktop retail POS conventions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || receipt) return
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'F4') {
        e.preventDefault()
        setDialog('customer')
      } else if (e.key === 'F8') {
        e.preventDefault()
        park()
      } else if (e.key === 'F9' || e.key === 'F12') {
        e.preventDefault()
        charge()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const setQty = (i: number, qty: number) =>
    setCart((c) => ({ ...c, lines: qty <= 0 ? c.lines.filter((_, j) => j !== i) : c.lines.map((l, j) => (j === i ? { ...l, qty } : l)) }))

  const clear = () => setCart({ lines: [], discount: 0 })

  const park = async () => {
    if (!cart.lines.length || !user) return
    const parked: ParkedSale = {
      label: customer?.name ?? `Sale ${new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`,
      createdAt: Date.now(),
      lines: cart.lines,
      discount: cart.discount,
      customerId: cart.customerId,
      userId: user.id!,
    }
    await db.parked.add(parked)
    clear()
    toast('Sale parked')
  }

  const charge = () => {
    if (!cart.lines.length) return
    if (cart.lines.some((l) => products.find((p) => p.id === l.productId)?.serialized && !l.serial)) {
      return toast('Enter serial numbers for serial-tracked items', 'error')
    }
    setDialog(shift ? 'pay' : 'shift')
  }

  const onPaid = async (payments: Sale['payments']) => {
    const sale = await completeSale({
      lines: cart.lines,
      discount: cart.discount,
      payments,
      customerId: cart.customerId,
      userId: user!.id!,
      shiftId: shift?.id,
    })
    clear()
    setDialog(null)
    setReceipt(sale)
  }

  return (
    <div className="flex h-full">
      {/* Catalogue */}
      <section className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-3 text-slate-400" />
            <input
              ref={searchRef}
              data-scan="allow"
              className="input h-11 pl-10 text-base"
              placeholder="Search name, SKU, part number — or scan a barcode (F2)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const p = findExact(query) ?? (visible.length === 1 ? visible[0] : undefined)
                if (p) {
                  addProduct(p)
                  setQuery('')
                }
              }}
            />
            {query && (
              <button className="absolute right-3 top-3 text-slate-400" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={18} />
              </button>
            )}
          </div>
          <div className="relative">
            <Bike size={18} className="pointer-events-none absolute left-3 top-3 text-slate-500" />
            <select className="input h-11 w-48 pl-10" value={bike} onChange={(e) => setBike(e.target.value)} title="Show parts that fit this bike">
              <option value="all">All bikes</option>
              {settings.bikeModels.map((m) => (
                <option key={m} value={m}>
                  Fits {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          <CategoryChip active={category === 'all'} onClick={() => setCategory('all')} color="#0f172a">
            All
          </CategoryChip>
          {categories.map((c) => (
            <CategoryChip key={c.id} active={category === c.id} onClick={() => setCategory(c.id!)} color={c.color}>
              {c.name}
            </CategoryChip>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {visible.map((p) => {
            const low = p.trackStock && p.stock <= p.reorderLevel
            return (
              <button
                key={p.id}
                onClick={() => addProduct(p)}
                className="tile flex h-32 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition active:scale-[0.98] hover:border-brand-400"
              >
                <div className="h-1.5 w-full" style={{ background: catColor[p.categoryId ?? -1] ?? '#cbd5e1' }} />
                <div className="flex flex-1 flex-col p-3">
                  <div className="line-clamp-2 text-sm font-semibold leading-tight">{p.name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{p.sku}</div>
                  <div className="mt-auto flex items-end justify-between">
                    <span className="text-base font-bold">{moneyShort(p.price)}</span>
                    {p.trackStock ? (
                      <Badge tone={p.stock <= 0 ? 'red' : low ? 'amber' : 'slate'}>{p.stock} left</Badge>
                    ) : (
                      <Badge tone="blue">service</Badge>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
          {visible.length === 0 && <div className="col-span-full py-16 text-center text-slate-500">No parts match. Try another search or bike filter.</div>}
        </div>
      </section>

      {/* Cart / ticket */}
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white xl:w-[420px]">
        <div className="flex items-center gap-2 border-b border-slate-200 p-3">
          <button className="btn-ghost flex-1 justify-start truncate" onClick={() => setDialog('customer')}>
            <UserRound size={16} />
            {customer ? (
              <span className="truncate">
                {customer.name}
                {customer.bikeModel && <span className="text-slate-400"> · {customer.bikeModel}</span>}
              </span>
            ) : (
              'Add customer (F4)'
            )}
          </button>
          <button className="btn-ghost relative px-3" onClick={() => setDialog('parked')} title="Parked sales">
            <PauseCircle size={16} />
            {parkedCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[10px] font-bold">{parkedCount}</span>
            )}
          </button>
          <button className="btn-ghost px-3" onClick={clear} disabled={!cart.lines.length} title="Clear sale">
            <Trash2 size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {cart.lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
              <ShoppingCart size={40} />
              <p className="text-sm">Tap a part or scan a barcode to start</p>
            </div>
          ) : (
            cart.lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => setDialog({ line: i })}>
                  <div className="truncate text-sm font-semibold">{l.name}</div>
                  <div className="text-xs text-slate-500">
                    {money(l.unitPrice, '')}
                    {l.discount > 0 && <span className="text-emerald-700"> · −{money(l.discount, '')}</span>}
                    {l.serial && <span> · S/N {l.serial}</span>}
                  </div>
                </button>
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button className="p-1.5" onClick={() => setQty(i, l.qty - 1)} aria-label="Decrease">
                    <Minus size={14} />
                  </button>
                  <span className="w-7 text-center text-sm font-semibold">{l.qty}</span>
                  <button className="p-1.5" onClick={() => setQty(i, l.qty + 1)} disabled={!!l.serial} aria-label="Increase">
                    <Plus size={14} />
                  </button>
                </div>
                <div className="w-20 text-right text-sm font-semibold">{money(lineTotal(l), '')}</div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 flex gap-2">
            <button className="btn-ghost flex-1 px-2" onClick={() => setDialog('custom')}>
              <Wrench size={16} /> Custom item
            </button>
            <button className="btn-ghost flex-1 px-2" onClick={() => setDialog('discount')} disabled={!cart.lines.length || !can('discount')}>
              <Percent size={16} /> Discount
            </button>
            <button className="btn-ghost flex-1 px-2" onClick={park} disabled={!cart.lines.length}>
              <PauseCircle size={16} /> Park
            </button>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>Subtotal · {totals.itemCount} items</dt>
              <dd>{money(totals.subtotal, settings.currency)}</dd>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Discount</dt>
                <dd>−{money(totals.discount, settings.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <dt>
                VAT {settings.vatRate}%{settings.pricesIncludeVat ? ' (incl.)' : ''}
              </dt>
              <dd>{money(totals.tax, settings.currency)}</dd>
            </div>
          </dl>
          <button className="btn-primary mt-3 h-16 w-full text-xl" onClick={charge} disabled={!cart.lines.length}>
            Charge {money(totals.total, settings.currency)}
          </button>
          <p className="mt-1 text-center text-[11px] text-slate-400">F2 search · F4 customer · F8 park · F9 charge</p>
        </div>
      </aside>

      {dialog === 'pay' && (
        <PaymentModal total={totals.total} settings={settings} customer={customer} onClose={() => setDialog(null)} onComplete={onPaid} />
      )}
      {dialog === 'customer' && (
        <CustomerPicker
          onClose={() => setDialog(null)}
          onPick={(c?: Customer) => {
            setCart((x) => ({ ...x, customerId: c?.id }))
            if (c?.bikeModel && settings.bikeModels.includes(c.bikeModel)) setBike(c.bikeModel)
            setDialog(null)
          }}
        />
      )}
      {dialog === 'discount' && (
        <DiscountModal
          subtotal={totals.subtotal}
          current={cart.discount}
          onClose={() => setDialog(null)}
          onApply={(d) => {
            setCart((c) => ({ ...c, discount: d }))
            setDialog(null)
          }}
        />
      )}
      {dialog === 'custom' && (
        <CustomItemModal
          onClose={() => setDialog(null)}
          onAdd={(line) => {
            setCart((c) => ({ ...c, lines: [...c.lines, line] }))
            setDialog(null)
          }}
        />
      )}
      {dialog === 'parked' && (
        <ParkedModal
          onClose={() => setDialog(null)}
          onResume={async (p) => {
            if (cart.lines.length) await park()
            setCart({ lines: p.lines, discount: p.discount, customerId: p.customerId })
            await db.parked.delete(p.id!)
            setDialog(null)
          }}
        />
      )}
      {dialog === 'shift' && (
        <OpenShiftModal
          onClose={() => setDialog(null)}
          onOpen={async (float) => {
            await openShift(user!.id!, float)
            setDialog('pay')
          }}
        />
      )}
      {dialog !== null && typeof dialog === 'object' && cart.lines[dialog.line] && (
        <LineEditor
          line={cart.lines[dialog.line]}
          allowPrice={can('discount')}
          serialized={!!products.find((p) => p.id === cart.lines[dialog.line].productId)?.serialized}
          onClose={() => setDialog(null)}
          onSave={(l) => {
            setCart((c) => ({ ...c, lines: c.lines.map((x, j) => (j === dialog.line ? l : x)) }))
            setDialog(null)
          }}
          onRemove={() => {
            setQty(dialog.line, 0)
            setDialog(null)
          }}
        />
      )}
      {receipt && (
        <ReceiptModal
          sale={receipt}
          settings={settings}
          isNew
          onClose={() => {
            setReceipt(null)
            searchRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

function CategoryChip({ active, color, onClick, children }: { active: boolean; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'
      }`}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {children}
    </button>
  )
}

function DiscountModal({ subtotal, current, onApply, onClose }: { subtotal: number; current: number; onApply: (d: number) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'%' | 'KES'>('%')
  const [value, setValue] = useState('')
  const amount = mode === '%' ? Math.round((subtotal * (parseFloat(value) || 0)) / 100) : toCents(value)
  return (
    <Modal
      title="Discount on whole sale"
      onClose={onClose}
      footer={
        <>
          {current > 0 && (
            <button className="btn-ghost mr-auto" onClick={() => onApply(0)}>
              Remove discount
            </button>
          )}
          <button className="btn-primary" onClick={() => onApply(Math.min(amount, subtotal))}>
            Apply −{money(Math.min(amount, subtotal))}
          </button>
        </>
      }
    >
      <div className="mb-3 flex gap-2">
        {(['%', 'KES'] as const).map((m) => (
          <button key={m} className={mode === m ? 'btn-dark flex-1' : 'btn-ghost flex-1'} onClick={() => setMode(m)}>
            {m === '%' ? 'Percent' : 'Amount'}
          </button>
        ))}
      </div>
      <input className="input text-lg" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === '%' ? 'e.g. 5' : 'e.g. 200'} />
      <div className="mt-3 flex gap-2">
        {[5, 10, 15].map((p) => (
          <button key={p} className="btn-ghost flex-1" onClick={() => onApply(Math.round((subtotal * p) / 100))}>
            {p}%
          </button>
        ))}
      </div>
    </Modal>
  )
}

function CustomItemModal({ onAdd, onClose }: { onAdd: (l: SaleLine) => void; onClose: () => void }) {
  const [name, setName] = useState('Labour')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState(1)
  return (
    <Modal
      title="Custom item / labour"
      onClose={onClose}
      footer={
        <button
          className="btn-primary"
          disabled={!name.trim() || toCents(price) <= 0}
          onClick={() => onAdd({ name: name.trim(), qty, unitPrice: toCents(price), unitCost: 0, discount: 0, taxable: true })}
        >
          Add to sale
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Description</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Price (KES)</label>
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="label">Qty</label>
            <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} />
          </div>
        </div>
      </div>
    </Modal>
  )
}

function LineEditor({
  line,
  allowPrice,
  serialized,
  onSave,
  onRemove,
  onClose,
}: {
  line: SaleLine
  allowPrice: boolean
  serialized: boolean
  onSave: (l: SaleLine) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [qty, setQty] = useState(line.qty)
  const [price, setPrice] = useState(String(line.unitPrice / 100))
  const [discount, setDiscount] = useState(String(line.discount / 100))
  const [serial, setSerial] = useState(line.serial ?? '')
  return (
    <Modal
      title={line.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn-danger mr-auto" onClick={onRemove}>
            <Trash2 size={16} /> Remove
          </button>
          <button
            className="btn-primary"
            onClick={() =>
              onSave({
                ...line,
                qty: serialized ? 1 : Math.max(1, qty),
                unitPrice: allowPrice ? toCents(price) : line.unitPrice,
                discount: allowPrice ? Math.min(toCents(discount), toCents(price) * qty) : line.discount,
                serial: serial.trim() || undefined,
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Qty</label>
          <input className="input" type="number" min={1} value={qty} disabled={serialized} onChange={(e) => setQty(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Unit price</label>
          <input className="input" inputMode="decimal" value={price} disabled={!allowPrice} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label className="label">Line discount</label>
          <input className="input" inputMode="decimal" value={discount} disabled={!allowPrice} onChange={(e) => setDiscount(e.target.value)} />
        </div>
      </div>
      {serialized && (
        <div className="mt-3">
          <label className="label">Serial number *</label>
          <input className="input font-mono" data-scan="allow" autoFocus value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Scan or type the serial on the part" />
          <p className="mt-1 text-xs text-slate-500">Recorded on the receipt for warranty claims.</p>
        </div>
      )}
    </Modal>
  )
}

function ParkedModal({ onResume, onClose }: { onResume: (p: ParkedSale) => void; onClose: () => void }) {
  const parked = useLiveQuery(() => db.parked.orderBy('createdAt').reverse().toArray(), [], [])
  return (
    <Modal title="Parked sales" onClose={onClose}>
      {parked.length === 0 && <p className="text-sm text-slate-500">No parked sales. Use Park to hold a sale while a customer fetches their bike or cash.</p>}
      <div className="divide-y divide-slate-100">
        {parked.map((p) => (
          <div key={p.id} className="flex items-center justify-between py-2">
            <div>
              <div className="font-semibold">{p.label}</div>
              <div className="text-xs text-slate-500">
                {p.lines.length} lines · {new Date(p.createdAt).toLocaleTimeString('en-KE')}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost px-3" onClick={() => db.parked.delete(p.id!)} aria-label="Delete parked sale">
                <Trash2 size={16} />
              </button>
              <button className="btn-primary" onClick={() => onResume(p)}>
                Resume
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function OpenShiftModal({ onOpen, onClose }: { onOpen: (float: number) => Promise<void>; onClose: () => void }) {
  const [float, setFloat] = useState('')
  const [error, setError] = useState('')
  return (
    <Modal
      title="Open shift"
      onClose={onClose}
      footer={
        <button className="btn-primary" onClick={() => onOpen(toCents(float)).catch((e) => setError(errorText(e)))}>
          Open shift
        </button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">Count the cash in the drawer before the first sale. This is your opening float.</p>
      <label className="label">Opening float (KES)</label>
      <input className="input text-lg" inputMode="decimal" autoFocus value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
