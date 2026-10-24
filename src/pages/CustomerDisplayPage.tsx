import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Monitor } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { computeTotals, lineTotal } from '../lib/cart'
import { money } from '../lib/money'
import { CART_KEY } from './SellPage'
import type { SaleLine } from '../db/types'

interface CartState {
  lines: SaleLine[]
  discount: number
  customerId?: number
}

function readCart(): CartState {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) ?? '') as CartState
  } catch {
    return { lines: [], discount: 0 }
  }
}

/** Second-screen view for the customer: live mirror of whatever is on the till. */
export default function CustomerDisplayPage() {
  const settings = useSettings()
  const [cart, setCart] = useState<CartState>(readCart)

  // The till writes the cart to localStorage; storage events fire here live.
  useEffect(() => {
    const sync = () => setCart(readCart())
    window.addEventListener('storage', sync)
    const poll = window.setInterval(sync, 1500)
    return () => {
      window.removeEventListener('storage', sync)
      window.clearInterval(poll)
    }
  }, [])

  const customer = useLiveQuery(
    () => (cart.customerId ? db.customers.get(cart.customerId) : undefined),
    [cart.customerId],
  )
  const totals = computeTotals(cart.lines, cart.discount, settings.vatRate, settings.pricesIncludeVat)

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b3039] text-white">
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-10 py-6">
        <div>
          <div className="text-[26px] font-medium" style={{ fontFamily: '"Poppins", sans-serif' }}>
            {settings.shopName}
          </div>
          <div className="text-sm text-white/50">Thank you for shopping with us</div>
        </div>
        <div className="flex items-center gap-3 text-white/40">
          <Monitor size={22} />
          <span className="text-sm uppercase tracking-[0.2em]">Customer display</span>
        </div>
      </header>

      <main className="custom-scrollbar min-h-0 flex-1 overflow-auto px-10 py-8">
        {customer && (
          <p className="mb-6 text-xl text-white/70">
            Serving <b className="text-white">{customer.name}</b>
          </p>
        )}

        {cart.lines.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-2xl font-light text-white/40">Welcome — your items will appear here as they are scanned</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/10">
            {cart.lines.map((line, index) => (
              <li key={`${line.productId ?? 'custom'}-${index}`} className="flex items-baseline justify-between gap-6 py-4">
                <span className="min-w-0">
                  <span className="block truncate text-2xl font-light">{line.name}</span>
                  {line.qty > 1 && <span className="text-base text-white/50">{line.qty} × {money(line.unitPrice, settings.currency)}</span>}
                </span>
                <span className="shrink-0 text-2xl">{money(lineTotal(line), settings.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="shrink-0 border-t border-white/10 px-10 py-8">
        <div className="flex items-end justify-between gap-10">
          <div className="space-y-2 text-xl text-white/60">
            <div className="flex justify-between gap-12">
              <span>Net total</span>
              <span>{money(totals.subtotal - totals.discount, settings.currency)}</span>
            </div>
            <div className="flex justify-between gap-12">
              <span>Tax</span>
              <span>{money(totals.tax, settings.currency)}</span>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between gap-12 text-[#7fd88f]">
                <span>Discount</span>
                <span>−{money(totals.discount, settings.currency)}</span>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-sm uppercase tracking-[0.25em] text-white/50">Total to pay</div>
            <div className="text-[64px] font-light leading-tight text-[#2bd760]" style={{ fontFamily: '"Poppins", sans-serif' }}>
              {money(totals.total, settings.currency)}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
