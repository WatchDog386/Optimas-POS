import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Boxes, Search, X } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import type { Product } from '../db/types'
import { Badge, Empty, ListPanel, PageHeader, Segmented } from '../components/ui'
import { money } from '../lib/money'
import { matchesSearch } from './SellPage'

type StockFilter = 'all' | 'in' | 'low' | 'out'
type StockStatus = 'in' | 'low' | 'out' | 'service'
type View = 'table' | 'grid'

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

const STOCK_TONE: Record<StockStatus, 'green' | 'amber' | 'red' | 'blue'> = {
  in: 'green',
  low: 'amber',
  out: 'red',
  service: 'blue',
}

export default function StaffProductsPage() {
  const settings = useSettings()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<number | 'all'>('all')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [view, setView] = useState<View>('table')

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

  const categoryName = (id?: number) => categories.find((cat) => cat.id === id)?.name ?? '—'

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Products" subtitle="Live stock levels — check here before promising a part to a customer." />

      <ListPanel
        title={`Products · ${visible.length} shown`}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented options={{ table: 'Table', grid: 'Icons' }} value={view} onChange={setView} dark />
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="w-60 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20"
                  placeholder="Search name, part no., SKU or barcode"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search products"
                />
                {query && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-400"
                value={stockFilter}
                onChange={(event) => setStockFilter(event.target.value as StockFilter)}
                aria-label="Filter by stock status"
              >
                <option value="all">All ({statusCounts.all})</option>
                <option value="in">In stock ({statusCounts.in})</option>
                <option value="low">Low stock ({statusCounts.low})</option>
                <option value="out">Out of stock ({statusCounts.out})</option>
              </select>
              <select
                className="max-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-400"
                value={category}
                onChange={(event) => setCategory(event.target.value ? Number(event.target.value) : 'all')}
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        }
      >
        {view === 'table' ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="table-head">
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Part no.</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const status = stockStatusOf(p)
                  return (
                    <tr key={p.id} className="table-row">
                      <td className="font-mono text-xs">{p.sku}</td>
                      <td>
                        <div className="font-semibold">{p.name}</div>
                        {p.fitment.length > 0 && (
                          <div className="text-xs text-slate-500">Fits: {p.fitment.join(', ')}</div>
                        )}
                      </td>
                      <td className="text-xs">{categoryName(p.categoryId)}</td>
                      <td className="text-xs">{p.partNumber || <span className="text-slate-400">—</span>}</td>
                      <td className="text-right font-semibold">{money(p.price, settings.currency)}</td>
                      <td className="text-right">
                        {p.trackStock ? <Badge tone={STOCK_TONE[status]}>{p.stock}</Badge> : <span className="text-slate-400">—</span>}
                      </td>
                      <td>
                        <Badge tone={STOCK_TONE[status]}>{STOCK_LABEL[status]}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((p) => {
              const status = stockStatusOf(p)
              return (
                <div
                  key={p.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card transition duration-150 hover:shadow-pop"
                >
                  <div className="aspect-square w-full bg-slate-100">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-300">
                        <Boxes size={40} strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="truncate text-sm font-semibold text-slate-800" title={p.name}>
                      {p.name}
                    </div>
                    <div className="truncate text-xs text-slate-400">{p.partNumber || p.sku}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">{money(p.price, settings.currency)}</span>
                      <Badge tone={STOCK_TONE[status]}>{p.trackStock ? `${p.stock} pcs` : 'Service'}</Badge>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {visible.length === 0 && <Empty>No products match this filter.</Empty>}
      </ListPanel>
    </div>
  )
}
