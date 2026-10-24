import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, Minus, Plus, Search, ShoppingCart, Trash2, X } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { completeSale } from '../db/sales'
import { openShift } from '../db/shifts'
import type { Customer, Product, Sale, SaleLine } from '../db/types'
import { computeTotals, lineTotal } from '../lib/cart'
import { money, toCents } from '../lib/money'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { useSession } from '../session'
import { Modal, useToast } from '../components/ui'
import PaymentModal from '../components/PaymentModal'
import ReceiptModal from '../components/ReceiptModal'
import CustomerPicker from '../components/CustomerPicker'
import { CART_KEY, lineFromProduct, matchesSearch, OpenShiftModal } from './SellPage'

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

type Dialog = 'pay' | 'customer' | 'discount' | 'custom' | 'parked' | 'shift' | { line: number } | null

export default function StaffDashboardPage() {
  const settings = useSettings()
  const { user, shift, can } = useSession()
  const toast = useToast()
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)

  const [cart, setCart] = useState<CartState>(loadCart)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<number | 'all'>('all')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [lastReceipt, setLastReceipt] = useState<Sale | null>(null)
  const [receiptIsNew, setReceiptIsNew] = useState(false)
  const [categoryPage, setCategoryPage] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [discountInput, setDiscountInput] = useState<string | null>(null)

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart))
    } catch {
      // The current sale remains usable if browser storage is unavailable.
    }
  }, [cart])

  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), [], [] as Product[])
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), [], [] as Customer[])
  const customer = useLiveQuery(
    () => (cart.customerId ? db.customers.get(cart.customerId) : undefined),
    [cart.customerId],
  )
  const parkedCount = useLiveQuery(() => db.parked.count(), [], 0)
  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])
  const todaySales = useLiveQuery(
    () => db.sales.where('createdAt').above(todayStart).toArray(),
    [todayStart],
    [] as Sale[],
  )
  const shiftSales = useLiveQuery(
    () => (shift ? db.sales.where('shiftId').equals(shift.id!).toArray() : Promise.resolve([] as Sale[])),
    [shift?.id],
    [] as Sale[],
  )

  const myToday = useMemo(
    () => todaySales.filter((s) => s.userId === user?.id && s.status !== 'voided'),
    [todaySales, user],
  )
  const myTodayTotal = myToday.reduce((sum, s) => sum + s.total, 0)
  const myRecent = useMemo(
    () =>
      todaySales
        .filter((s) => s.userId === user?.id && s.status !== 'voided')
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5),
    [todaySales, user],
  )
  const cashInDrawer = useMemo(() => {
    if (!shift) return null
    let cash = shift.openingFloat
    for (const s of shiftSales) {
      if (s.status === 'voided') continue
      if (s.payments.some((p) => p.method === 'cash')) {
        cash += s.payments.filter((p) => p.method === 'cash').reduce((sum, p) => sum + p.amount, 0)
        cash -= s.change
      }
    }
    for (const m of shift.cashMovements) cash += m.type === 'in' ? m.amount : -m.amount
    return cash
  }, [shift, shiftSales])
  const lowStockCount = useMemo(
    () => products.filter((p) => p.trackStock && p.stock <= p.reorderLevel).length,
    [products],
  )

  const visible = useMemo(() => {
    const term = query.trim()
    return products
      .filter((p) => category === 'all' || p.categoryId === category)
      .filter((p) => !term || matchesSearch(p, term))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, category, query])

  const totals = computeTotals(cart.lines, cart.discount, settings.vatRate, settings.pricesIncludeVat)
  const categoryPages = Math.max(1, Math.ceil(categories.length / 2))
  const visibleCategories = categories.slice(categoryPage * 2, categoryPage * 2 + 2)
  const isLookingUp = query.trim().length > 0 || category !== 'all'
  const latestLineIndex = cart.lines.length - 1

  useEffect(() => {
    setCategoryPage((page) => Math.min(page, categoryPages - 1))
  }, [categoryPages])

  const qtyInCart = (productId?: number) =>
    cart.lines.filter((l) => l.productId === productId).reduce((sum, l) => sum + l.qty, 0)

  const findExact = (code: string) => {
    const value = code.trim().toLowerCase()
    return products.find(
      (p) => p.barcode?.toLowerCase() === value || p.sku.toLowerCase() === value || p.partNumber?.toLowerCase() === value,
    )
  }

  const addProduct = (product: Product) => {
    const inCart = qtyInCart(product.id)
    if (product.trackStock && product.stock - inCart <= 0) {
      toast(`${product.name}: no stock recorded — sale will go negative`, 'error')
    }
    setCart((current) => {
      const index = product.serialized ? -1 : current.lines.findIndex((line) => line.productId === product.id && !line.serial)
      if (index >= 0) {
        return {
          ...current,
          lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, qty: line.qty + 1 } : line)),
        }
      }
      return { ...current, lines: [...current.lines, lineFromProduct(product)] }
    })
  }

  const taxExempt = cart.lines.length > 0 && cart.lines.every((line) => !line.taxable)

  const toggleTaxExempt = () =>
    setCart((current) => ({ ...current, lines: current.lines.map((line) => ({ ...line, taxable: taxExempt })) }))

  const applyDiscountPercent = (percent: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)))
    setCart((current) => ({ ...current, discount: Math.round((totals.subtotal * clamped) / 100) }))
  }

  const discountPercent = totals.subtotal > 0 ? Math.round((cart.discount / totals.subtotal) * 100) : 0

  useBarcodeScanner(
    (code) => {
      const product = findExact(code)
      if (product) addProduct(product)
      else toast(`No product with barcode ${code}`, 'error')
    },
    dialog === null && receipt === null,
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialog || receipt) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'F2') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'F4') {
        event.preventDefault()
        navigate('/shift')
      } else if (event.key === 'F5' || event.key === 'F9') {
        event.preventDefault()
        placeOrder()
      } else if (event.key === 'F6') {
        event.preventDefault()
        clear()
      } else if (event.key === 'F8') {
        event.preventDefault()
        void park()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const setQty = (index: number, qty: number) =>
    setCart((current) => ({
      ...current,
      lines:
        qty <= 0
          ? current.lines.filter((_, lineIndex) => lineIndex !== index)
          : current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, qty } : line)),
    }))

  const clear = () => {
    setCart({ lines: [], discount: 0 })
  }

  const park = async () => {
    if (!cart.lines.length || !user) return
    await db.parked.add({
      label: customer?.name ?? `Sale ${new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`,
      createdAt: Date.now(),
      lines: cart.lines,
      discount: cart.discount,
      customerId: cart.customerId,
      userId: user.id!,
    })
    clear()
    toast('Sale parked')
  }

  const placeOrder = () => {
    if (!cart.lines.length) return
    if (cart.lines.some((line) => products.find((product) => product.id === line.productId)?.serialized && !line.serial)) {
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
    setLastReceipt(sale)
    setReceiptIsNew(true)
    setReceipt(sale)
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      toast('Full screen is not available in this browser', 'error')
    }
  }

  const openLastReceipt = () => {
    if (!lastReceipt) return toast('Complete a sale before printing its receipt', 'error')
    setReceiptIsNew(false)
    setReceipt(lastReceipt)
  }

  const runSearch = () => {
    const product = findExact(query) ?? (visible.length === 1 ? visible[0] : undefined)
    if (product) {
      addProduct(product)
      setQuery('')
      searchRef.current?.focus()
    } else {
      searchRef.current?.focus()
    }
  }

  return (
    <div className="pos-checkout pos-terminal flex h-full min-h-0 flex-col overflow-hidden">
      <div className="pos-terminal-strip">
        <span className="pos-strip-chip">
          <b>{user?.name}</b> · <span className="capitalize">{user?.role}</span>
        </span>
        {shift ? (
          <span className="pos-strip-chip">
            Shift opened{' '}
            {new Date(shift.openedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : (
          <span className="pos-strip-chip is-warn">No open shift — one will open when you charge</span>
        )}
        {cashInDrawer !== null && (
          <span className="pos-strip-chip">
            Cash in drawer <b>{money(cashInDrawer, settings.currency)}</b>
          </span>
        )}
        <span className="pos-strip-chip">
          Today <b>{myToday.length}</b> sales · <b>{money(myTodayTotal, settings.currency)}</b>
        </span>
        {lowStockCount > 0 && <span className="pos-strip-chip is-warn">{lowStockCount} parts low on stock</span>}
      </div>

      <div className="pos-terminal-workspace">
        <section className="pos-terminal-ticket" aria-label="Current sale">
          <div className="pos-terminal-heading">
            <h1>Product</h1>
            <span>{settings.shopName.toUpperCase()} · COUNTER</span>
          </div>

          <div className="pos-terminal-search">
            <label htmlFor="part-search">Search product by name or ID</label>
            <div className="pos-terminal-search-row">
              <input
                id="part-search"
                ref={searchRef}
                data-scan="allow"
                placeholder="Part no., SKU, OEM or barcode"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') runSearch()
                }}
              />
              {query && (
                <button className="pos-search-clear" onClick={() => setQuery('')} aria-label="Clear product search">
                  <X size={15} />
                </button>
              )}
              <button className="pos-register-action pos-search-submit" onClick={runSearch}>
                <Search size={17} /> Search
              </button>
            </div>
          </div>

          <div className="pos-customer-row">
            <div className="pos-customer-field">
              <label htmlFor="customer-select">Bill to:</label>
              <select
                id="customer-select"
                className="pos-customer-select"
                value={cart.customerId ?? ''}
                onChange={(event) => setCart((current) => ({ ...current, customerId: event.target.value ? Number(event.target.value) : undefined }))}
              >
                <option value="">Walk-in customer</option>
                {customers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}{entry.bikeModel ? ` — ${entry.bikeModel}` : ''}
                  </option>
                ))}
              </select>
              {customer && (
                <p className="pos-customer-detail">
                  {[customer.phone, customer.plate, customer.bikeModel].filter(Boolean).join(' · ')}
                  {customer.balance > 0 ? ` · Owes ${money(customer.balance, settings.currency)}` : ''}
                </p>
              )}
            </div>
            <div className="pos-customer-actions">
              <button className="pos-register-action pos-register-action-green" onClick={() => setDialog('customer')}>
                Find Customer
              </button>
              <button className="pos-register-action pos-register-action-red" onClick={() => setDialog('customer')}>
                Add Customer
              </button>
            </div>
          </div>

          <div className="pos-cart">
            <div className="pos-cart-scroll custom-scrollbar">
              <table className="pos-cart-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Product name</th>
                    <th>Amount</th>
                    <th>Discount</th>
                    <th>Row total</th>
                    <th aria-label="Remove item" />
                  </tr>
                </thead>
                <tbody>
                  {cart.lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="pos-cart-empty">
                        <ShoppingCart size={23} strokeWidth={1.5} />
                        <span>Search or scan a product to begin this sale.</span>
                      </td>
                    </tr>
                  ) : (
                    cart.lines.map((line, index) => (
                      <tr key={`${line.productId ?? 'custom'}-${index}`}>
                        <td className="pos-cart-id">{line.productId ? String(line.productId).padStart(5, '0') : 'LAB'}</td>
                        <td className="pos-cart-product">
                          <button onClick={() => setDialog({ line: index })}>{line.name}</button>
                          {line.serial && <small>S/N {line.serial}</small>}
                        </td>
                        <td>
                          <div className="pos-qty-control">
                            <button onClick={() => setQty(index, line.qty - 1)} aria-label={`Decrease ${line.name}`}>
                              <Minus size={12} />
                            </button>
                            <span>{line.qty}</span>
                            <button
                              onClick={() => setQty(index, line.qty + 1)}
                              disabled={!!line.serial}
                              aria-label={`Increase ${line.name}`}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="pos-cart-money">{line.discount > 0 ? `−${money(line.discount, settings.currency)}` : '0%'}</td>
                        <td className="pos-cart-money pos-cart-rowtotal">{money(lineTotal(line), settings.currency)}</td>
                        <td>
                          <button className="pos-cart-remove" onClick={() => setQty(index, 0)} aria-label={`Remove ${line.name}`}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pos-terminal-summary">
            <div className="pos-discount-control">
              <span>Discount</span>
              <button
                className="pos-discount-step"
                onClick={() => applyDiscountPercent(discountPercent - 1)}
                disabled={!cart.lines.length || !can('discount')}
                aria-label="Decrease discount"
              >
                −
              </button>
              <input
                className="pos-discount-input"
                inputMode="numeric"
                aria-label="Discount percent"
                value={discountInput ?? String(discountPercent)}
                onChange={(event) => {
                  const raw = event.target.value.replace(/[^\d]/g, '')
                  setDiscountInput(raw)
                  if (raw !== '') applyDiscountPercent(Number(raw))
                }}
                onFocus={() => setDiscountInput(String(discountPercent))}
                onBlur={() => setDiscountInput(null)}
                disabled={!cart.lines.length || !can('discount')}
              />
              <button
                className="pos-discount-step"
                onClick={() => applyDiscountPercent(discountPercent + 1)}
                disabled={!cart.lines.length || !can('discount')}
                aria-label="Increase discount"
              >
                +
              </button>
              <span className="pos-discount-unit">%</span>
            </div>
            <dl>
              <div>
                <dt>Net total:</dt>
                <dd>{money(totals.subtotal - totals.discount, settings.currency)}</dd>
              </div>
              <div>
                <dt>Total tax:</dt>
                <dd>{money(totals.tax, settings.currency)}</dd>
              </div>
              <div className="pos-terminal-total">
                <dt>Total:</dt>
                <dd>{money(totals.total, settings.currency)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <aside className="pos-terminal-tools" aria-label="Product lookup and sale actions">
          <div className="pos-category-pager">
            <button
              className="pos-category-arrow"
              onClick={() => setCategoryPage((page) => Math.max(0, page - 1))}
              disabled={categoryPage === 0}
              aria-label="Previous product categories"
            >
              <ChevronsLeft size={22} />
            </button>
            {visibleCategories.length > 0 ? (
              visibleCategories.map((entry) => (
                <button
                  key={entry.id}
                  className={`pos-category-button ${category === entry.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setCategory(entry.id!)
                    setQuery('')
                  }}
                >
                  {entry.name}
                </button>
              ))
            ) : (
              <button className="pos-category-button is-active" onClick={() => setCategory('all')}>
                All parts
              </button>
            )}
            <button
              className="pos-category-arrow"
              onClick={() => setCategoryPage((page) => Math.min(categoryPages - 1, page + 1))}
              disabled={categoryPage >= categoryPages - 1}
              aria-label="Next product categories"
            >
              <ChevronsRight size={22} />
            </button>
          </div>

          <div className="pos-product-information">
            <strong>Product Information</strong>
            <p>{isLookingUp ? `${visible.length} matching product${visible.length === 1 ? '' : 's'} available.` : 'Search by part number, SKU, OEM or barcode.'}</p>
            <p>{category === 'all' ? 'Choose a category or start typing to look up stock.' : 'Use the product list below to add a part.'}</p>
            {lowStockCount > 0 && <p>{lowStockCount} part{lowStockCount === 1 ? '' : 's'} at or below reorder level — see the Products page.</p>}
          </div>

          <div className="pos-tool-actions">
            <button className="pos-register-action" onClick={() => searchRef.current?.focus()}>
              Add product
            </button>
            <button
              className="pos-register-action"
              onClick={() => latestLineIndex >= 0 && setDialog({ line: latestLineIndex })}
              disabled={latestLineIndex < 0}
            >
              Edit product
            </button>
            <button className="pos-register-action" onClick={() => void park()} disabled={!cart.lines.length}>
              Save sale
            </button>
            <button className="pos-register-action" onClick={() => setDialog('customer')}>
              Add customer
            </button>
            <button className="pos-register-action" onClick={() => setDialog('customer')} disabled={!customer}>
              Edit customer
            </button>
            <button
              className="pos-register-action"
              onClick={() => setDialog('discount')}
              disabled={!cart.lines.length || !can('discount')}
            >
              Add coupons
            </button>
            <button
              className={`pos-register-action ${taxExempt ? 'is-active' : ''}`}
              onClick={toggleTaxExempt}
              disabled={!cart.lines.length}
              title="Remove VAT from every line on this sale"
            >
              {taxExempt ? 'Tax charged' : 'Tax exempt'}
            </button>
            <button className="pos-register-action" onClick={() => void toggleFullscreen()}>
              Full screen {isFullscreen ? 'OFF' : 'ON'}
            </button>
            <button className="pos-register-action" onClick={() => navigate('/sales')}>
              Report
            </button>
          </div>

          <div className="pos-product-lookup">
            <div className="pos-product-lookup-title">
              <span>Product lookout</span>
              <div className="pos-lookup-title-actions">
                <button onClick={() => setDialog('custom')}>Custom item</button>
                <button onClick={() => setDialog('parked')}>Parked{parkedCount ? ` (${parkedCount})` : ''}</button>
              </div>
            </div>
            {isLookingUp ? (
              <div className="pos-product-results custom-scrollbar">
                {visible.length === 0 ? (
                  <p>No parts match this search.</p>
                ) : (
                  visible.slice(0, 7).map((product) => (
                    <button key={product.id} onClick={() => addProduct(product)}>
                      <span>
                        <b>{product.name}</b>
                        <small>{product.sku}{product.trackStock ? ` · ${product.stock} in stock` : ''}</small>
                      </span>
                      <strong>{money(product.price, settings.currency)}</strong>
                      <Plus size={15} />
                    </button>
                  ))
                )}
              </div>
            ) : (
              <button className="pos-lookup-empty" onClick={() => searchRef.current?.focus()}>
                <Search size={18} />
                <span>Search for a part, then select it to add it to this sale.</span>
              </button>
            )}
          </div>

          <div className="pos-recent-sales">
            <div className="pos-recent-title">Recent receipts</div>
            <div className="pos-recent-list custom-scrollbar">
              {myRecent.length === 0 ? (
                <p>Receipts you charge will appear here for quick reprints.</p>
              ) : (
                myRecent.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setReceiptIsNew(false)
                      setReceipt(s)
                    }}
                  >
                    <span>
                      <b>{s.receiptNo}</b>
                      <small>
                        {new Date(s.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                        {s.lines.length} line{s.lines.length === 1 ? '' : 's'}
                      </small>
                    </span>
                    <strong>{money(s.total, settings.currency)}</strong>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer className="pos-terminal-actions" aria-label="Sale actions">
        <button className="pos-terminal-action pos-terminal-pay" onClick={placeOrder} disabled={!cart.lines.length}>
          <span>Pay</span><small>(F5)</small>
        </button>
        <button className="pos-terminal-action" onClick={() => navigate('/sales')}>
          <span>Return</span>
        </button>
        <button className="pos-terminal-action pos-terminal-new" onClick={clear}>
          <span>New Sale</span><small>(F6)</small>
        </button>
        <button className="pos-terminal-action pos-terminal-void" onClick={clear} disabled={!cart.lines.length}>
          <span>Void</span>
        </button>
        <button className="pos-terminal-action" onClick={() => navigate('/shift')}>
          <span>End Day</span><small>(F4)</small>
        </button>
        <button className="pos-terminal-action" onClick={openLastReceipt}>
          <span>Print</span>
        </button>
      </footer>

      {dialog === 'pay' && (
        <PaymentModal
          total={totals.total}
          settings={settings}
          customer={customer}
          onClose={() => setDialog(null)}
          onComplete={onPaid}
        />
      )}
      {dialog === 'customer' && (
        <CustomerPicker
          onClose={() => setDialog(null)}
          onPick={(entry?: Customer) => {
            setCart((current) => ({ ...current, customerId: entry?.id }))
            setDialog(null)
          }}
        />
      )}
      {dialog === 'discount' && (
        <DiscountModal
          subtotal={totals.subtotal}
          current={cart.discount}
          onClose={() => setDialog(null)}
          onApply={(discount) => {
            setCart((current) => ({ ...current, discount }))
            setDialog(null)
          }}
        />
      )}
      {dialog === 'custom' && (
        <CustomItemModal
          onClose={() => setDialog(null)}
          onAdd={(line) => {
            setCart((current) => ({ ...current, lines: [...current.lines, line] }))
            setDialog(null)
          }}
        />
      )}
      {dialog === 'parked' && (
        <ParkedModal
          onClose={() => setDialog(null)}
          onResume={async (sale) => {
            if (cart.lines.length) await park()
            setCart({ lines: sale.lines, discount: sale.discount, customerId: sale.customerId })
            await db.parked.delete(sale.id!)
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
          serialized={!!products.find((product) => product.id === cart.lines[dialog.line].productId)?.serialized}
          onClose={() => setDialog(null)}
          onSave={(line) => {
            setCart((current) => ({ ...current, lines: current.lines.map((entry, index) => (index === dialog.line ? line : entry)) }))
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
          isNew={receiptIsNew}
          autoPrint
          onClose={() => {
            setReceipt(null)
            setReceiptIsNew(false)
            searchRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

function DiscountModal({
  subtotal,
  current,
  onApply,
  onClose,
}: {
  subtotal: number
  current: number
  onApply: (d: number) => void
  onClose: () => void
}) {
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
            <button className="mc-btn mr-auto" onClick={() => onApply(0)}>
              Remove discount
            </button>
          )}
          <button className="mc-btn-primary" onClick={() => onApply(Math.min(amount, subtotal))}>
            Apply −{money(Math.min(amount, subtotal))}
          </button>
        </>
      }
    >
      <div className="mb-3 flex gap-2">
        {(['%', 'KES'] as const).map((entry) => (
          <button key={entry} className={mode === entry ? 'mc-btn-primary flex-1' : 'mc-btn flex-1'} onClick={() => setMode(entry)}>
            {entry === '%' ? 'Percent' : 'Amount'}
          </button>
        ))}
      </div>
      <input
        className="input text-lg"
        inputMode="decimal"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={mode === '%' ? 'e.g. 5' : 'e.g. 200'}
      />
      <div className="mt-3 flex gap-2">
        {[5, 10, 15].map((percent) => (
          <button key={percent} className="mc-btn flex-1" onClick={() => onApply(Math.round((subtotal * percent) / 100))}>
            {percent}%
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
          className="mc-btn-primary"
          disabled={!name.trim() || toCents(price) <= 0}
          onClick={() =>
            onAdd({
              name: name.trim(),
              qty,
              unitPrice: toCents(price),
              unitCost: 0,
              discount: 0,
              taxable: true,
            })
          }
        >
          Add to sale
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Description</label>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Price (KES)</label>
            <input className="input" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          </div>
          <div>
            <label className="label">Qty</label>
            <input
              className="input"
              type="number"
              min={1}
              value={qty}
              onChange={(event) => setQty(Math.max(1, Number(event.target.value)))}
            />
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
          <button className="mc-btn-danger mr-auto" onClick={onRemove}>
            <Trash2 size={16} /> Remove
          </button>
          <button
            className="mc-btn-primary"
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
          <input
            className="input"
            type="number"
            min={1}
            value={qty}
            disabled={serialized}
            onChange={(event) => setQty(Number(event.target.value))}
          />
        </div>
        <div>
          <label className="label">Unit price</label>
          <input className="input" inputMode="decimal" value={price} disabled={!allowPrice} onChange={(event) => setPrice(event.target.value)} />
        </div>
        <div>
          <label className="label">Line discount</label>
          <input className="input" inputMode="decimal" value={discount} disabled={!allowPrice} onChange={(event) => setDiscount(event.target.value)} />
        </div>
      </div>
      {serialized && (
        <div className="mt-3">
          <label className="label">Serial number *</label>
          <input
            className="input font-mono"
            data-scan="allow"
            autoFocus
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
            placeholder="Scan or type the serial on the part"
          />
          <p className="mt-1 text-xs text-mc-faint">Recorded on the receipt for warranty claims.</p>
        </div>
      )}
    </Modal>
  )
}

function ParkedModal({ onResume, onClose }: { onResume: (p: { id?: number; lines: SaleLine[]; discount: number; customerId?: number }) => void; onClose: () => void }) {
  const parked = useLiveQuery(() => db.parked.orderBy('createdAt').reverse().toArray(), [], [])
  return (
    <Modal title="Parked sales" onClose={onClose}>
      {parked.length === 0 && <p className="text-sm text-mc-muted">No parked sales. Use Save sale to set a sale aside.</p>}
      <div className="divide-y divide-mc-line">
        {parked.map((sale) => (
          <div key={sale.id} className="flex items-center justify-between py-2">
            <div>
              <div className="font-semibold text-mc-body">{sale.label}</div>
              <div className="text-[11px] text-mc-muted">
                {sale.lines.length} lines · {new Date(sale.createdAt).toLocaleTimeString('en-KE')}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="mc-btn p-2" onClick={() => db.parked.delete(sale.id!)} aria-label="Delete parked sale">
                <Trash2 size={16} />
              </button>
              <button className="mc-btn-primary" onClick={() => onResume(sale)}>
                Resume
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
