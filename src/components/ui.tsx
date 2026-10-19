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
          className="tile h-14 rounded-xl border border-slate-200 bg-white text-xl font-semibold text-slate-800 shadow-sm active:bg-slate-100"
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
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-slate-500">{children}</div>
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
