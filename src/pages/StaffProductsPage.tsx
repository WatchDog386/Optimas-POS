import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Boxes, Search, X } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import type { Product } from '../db/types'
import { money } from '../lib/money'
import { matchesSearch } from './SellPage'

type StockFilter = 'all' | 'in' | 'low' | 'out'

type StockStatus = 'in' | 'low' | 'out' | 'service'

export function stockStatusOf(p: Product): StockStatus {
  if (!p.trackStock) return 'service'
  if (p.stock <= 0) return 'out'
  if (p.stock <= p.reorderLevel) return 'low'
  return 'in'
}

const STOCK_LABEL: Record<StockStatus, string> = {
  in: 'In stock',
  low: 'Low stock',
  out: 'Out of stock',
  service: 'Service',
}

export default function StaffProductsPage() {
  const settings = useSettings()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<number | 'all'>('all')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')

  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), [], [] as Product[])

  const statusCounts = useMemo(() => {
    const counts: Record<StockFilter, number> = { all: products.length, in: 0, low: 0, out: 0 }
    for (const p of products) {
      const status = stockStatusOf(p)
      if (status !== 'service') counts[status]++
    }
    return counts
  }, [products])

  const visible = useMemo(() => {
    const term = query.trim()
    return products
      .filter((p) => category === 'all' || p.categoryId === category)
      .filter((p) => !term || matchesSearch(p, term))
      .filter((p) => stockFilter === 'all' || stockStatusOf(p) === stockFilter)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, category, query, stockFilter])

  const categoryName = (id?: number) => categories.find((c) => c.id === id)?.name ?? '—'

  return (
    <div className="pos-checkout pos-products flex h-full min-h-0 flex-col overflow-hidden">
      <div className="pos-products-head">
        <div>
          <h1>Products</h1>
          <p>Live stock levels — check here before promising a part to a customer.</p>
        </div>
        <div className="pos-products-tools">
          <div className="pos-products-search">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, part no., SKU or barcode"
              aria-label="Search products"
            />
            {query ? (
              <button onClick={() => setQuery('')} aria-label="Clear search">
                <X size={16} />
              </button>
            ) : (
              <span>
                <Search size={16} />
              </span>
            )}
          </div>
          <label className="pos-products-filter">
            <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as StockFilter)}>
              <option value="all">All ({statusCounts.all})</option>
              <option value="in">In stock ({statusCounts.in})</option>
              <option value="low">Low stock ({statusCounts.low})</option>
              <option value="out">Out of stock ({statusCounts.out})</option>
            </select>
          </label>
          <label className="pos-products-filter">
            <select value={category} onChange={(event) => setCategory(event.target.value ? Number(event.target.value) : 'all')}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="pos-products-body custom-scrollbar">
        <table className="pos-products-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Product</th>
              <th>Category</th>
              <th>Part no.</th>
              <th>Price</th>
              <th className="pos-products-stock">Stock</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="pos-products-empty">
                  <Boxes size={26} strokeWidth={1.5} />
                  <span>No products match this filter.</span>
                </td>
              </tr>
            ) : (
              visible.map((p) => {
                const status = stockStatusOf(p)
                return (
                  <tr key={p.id}>
                    <td className="pos-products-id">{String(p.id).padStart(5, '0')}</td>
                    <td>
                      <div className="pos-products-name">{p.name}</div>
                      {p.fitment.length > 0 && <small>Fits: {p.fitment.join(', ')}</small>}
                    </td>
                    <td>{categoryName(p.categoryId)}</td>
                    <td>{p.partNumber || p.sku}</td>
                    <td className="pos-products-price">{money(p.price, settings.currency)}</td>
                    <td className="pos-products-stock">
                      {p.trackStock ? (
                        <span className="pos-stock-pill" data-status={status}>
                          {p.stock}
                        </span>
                      ) : (
                        <span className="pos-stock-pill" data-status="service">
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`pos-status-badge is-${status}`}>{STOCK_LABEL[status]}</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
