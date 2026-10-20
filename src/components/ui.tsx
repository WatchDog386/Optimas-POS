import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={onClose}>
      <div
        className={`flex max-h-[92vh] w-full flex-col rounded-2xl bg-white shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function NumPad({ onKey, keys }: { onKey: (k: string) => void; keys?: string[] }) {
  const layout = keys ?? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']
  return (
    <div className="grid grid-cols-3 gap-2">
      {layout.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          className="tile h-14 rounded-2xl bg-white text-xl font-semibold text-slate-800 shadow-[6px_6px_14px_rgba(15,39,44,0.12),-6px_-6px_14px_rgba(255,255,255,0.95)] transition active:shadow-[inset_5px_5px_10px_rgba(15,39,44,0.14),inset_-5px_-5px_10px_rgba(255,255,255,0.95)] active:text-brand-600"
        >
          {k}
        </button>
      ))}
    </div>
  )
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-sky-100 text-sky-800',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[34px] font-light leading-tight tracking-tight text-slate-700">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-slate-500">{children}</div>
}

/** Dark panel chrome around a data table (title bar + optional toolbar + table). */
export function ListPanel({
  title,
  actions,
  toolbar,
  children,
  footer,
}: {
  title: ReactNode
  actions?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-none border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#3d5160] px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {toolbar && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#4a5e6d] px-4 py-2.5">{toolbar}</div>
      )}
      <div className="overflow-x-auto">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">
          {footer}
        </div>
      )}
    </div>
  )
}

/** Pill / segmented control used on list headers. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  dark,
}: {
  options: Record<T, string>
  value: T
  onChange: (v: T) => void
  dark?: boolean
}) {
  return (
    <div
      className={`inline-flex rounded-none p-0.5 ${dark ? 'bg-[#2f3f4c] ring-1 ring-white/10' : 'border border-slate-300 bg-white'}`}
    >
      {(Object.keys(options) as T[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`rounded-none px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
            value === k
              ? dark
                ? 'bg-white text-navy-900 shadow'
                : 'bg-navy-900 text-white'
              : dark
                ? 'text-slate-300 hover:text-white'
                : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {options[k]}
        </button>
      ))}
    </div>
  )
}

/** Pagination footer matching the reference (« ‹ Page n of m › »). */
export function TablePager({
  page,
  pages,
  onPage,
  total,
}: {
  page: number
  pages: number
  onPage: (p: number) => void
  total: number
}) {
  if (pages <= 1) {
    return <span className="text-xs text-slate-500">{total} row{total === 1 ? '' : 's'}</span>
  }
  const btn = 'flex h-7 w-7 items-center justify-center rounded-none border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40'
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">
        «
      </button>
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        ‹
      </button>
      <span className="px-2 text-sm">
        Page <span className="font-bold text-brand-600">{page}</span> of{' '}
        <span className="font-bold text-navy-900">{pages}</span>
      </span>
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        ›
      </button>
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Last page">
        »
      </button>
    </div>
  )
}

// --- toasts ---
type Toast = { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${t.tone === 'error' ? 'bg-red-600' : 'bg-slate-900'}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
