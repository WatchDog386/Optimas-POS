// Vehicle Fit Matrix: which part fits which bike model, edited in one grid.
// Drives the "Fits" filters on both sell screens.

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { Bike, Check, Search } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import type { Product } from '../db/types'
import { PageHeader, useToast } from '../components/ui'

export default function FitMatrixPage() {
  const settings = useSettings()
  const toast = useToast()
  const products = useLiveQuery(() => db.products.orderBy('name').filter((p) => p.active).toArray(), [], [] as Product[])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<number | 'all'>('all')
  const [gaps, setGaps] = useState(false)
  const models = settings.bikeModels

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return products
      .filter((p) => cat === 'all' || p.categoryId === cat)
      .filter((p) => !gaps || p.fitment.length === 0)
      .filter((p) => !t || [p.name, p.sku, p.partNumber, p.brand].some((v) => v?.toLowerCase().includes(t)))
  }, [products, q, cat, gaps])

  const perModel = useMemo(() => Object.fromEntries(models.map((m) => [m, products.filter((p) => p.fitment.length === 0 || p.fitment.includes(m)).length])), [products, models])

  const toggle = async (p: Product, model: string) => {
    const fitment = p.fitment.includes(model) ? p.fitment.filter((m) => m !== model) : [...p.fitment, model]
    await db.products.update(p.id!, { fitment, updatedAt: Date.now() })
  }

  const setAll = async (p: Product, all: boolean) => {
    await db.products.update(p.id!, { fitment: all ? [...models] : [], updatedAt: Date.now() })
    toast(all ? `${p.name} fits every model` : `${p.name} marked universal`)
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Vehicle Fit Matrix"
        subtitle="Tick the bike models each part fits. Parts with no ticks are treated as universal and show for every bike."
        actions={
          <Link to="/settings?tab=Bike%20models" className="btn-ghost">
            <Bike size={16} /> Manage bike models
          </Link>
        }
      />

      {models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No bike models yet. Add the models your customers ride under Settings → Bike models.
        </div>
      ) : (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {models.map((m) => (
              <div key={m} className="rounded-xl border border-hairline bg-white px-4 py-3 shadow-card">
                <div className="truncate text-sm font-semibold text-slate-800">{m}</div>
                <div className="text-xs text-slate-500">{perModel[m]} parts fit</div>
              </div>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-72 max-w-full">
              <Search size={14} className="absolute left-3 top-3 text-slate-400" />
              <input className="input pl-9" placeholder="Search part, SKU, OEM…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="input w-48" value={cat} onChange={(e) => setCat(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-hairline">
              <input type="checkbox" checked={gaps} onChange={(e) => setGaps(e.target.checked)} /> Only parts with no fitment set
            </label>
            <span className="ml-auto text-xs text-slate-500">{rows.length} parts</span>
          </div>

          <div className="overflow-auto rounded-xl border border-hairline bg-white shadow-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">Part</th>
                  {models.map((m) => (
                    <th key={m} className="px-2 py-2.5 text-center">
                      {m}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right">Quick set</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2">
                      <div className="font-semibold text-slate-800">{p.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {p.sku}
                        {p.partNumber && p.partNumber !== p.sku ? ` · OEM ${p.partNumber}` : ''}
                        {p.fitment.length === 0 && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-sans font-semibold text-slate-600">Universal</span>}
                      </div>
                    </td>
                    {models.map((m) => {
                      const on = p.fitment.includes(m)
                      return (
                        <td key={m} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => void toggle(p, m)}
                            aria-label={`${p.name} ${on ? 'fits' : 'does not fit'} ${m}`}
                            aria-pressed={on}
                            className={`inline-grid h-8 w-8 place-items-center rounded-lg border transition ${
                              on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-200 bg-white text-transparent hover:border-brand-300 hover:text-brand-300'
                            }`}
                          >
                            <Check size={16} strokeWidth={3} />
                          </button>
                        </td>
                      )
                    })}
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                      <button className="font-semibold text-brand-600 hover:underline" onClick={() => void setAll(p, true)}>
                        All
                      </button>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <button className="font-semibold text-slate-500 hover:underline" onClick={() => void setAll(p, false)}>
                        Universal
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={models.length + 2} className="px-4 py-10 text-center text-slate-500">
                      No parts match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
