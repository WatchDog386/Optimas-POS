import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudOff, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { syncNow, useSyncStatus, type SyncStatus } from '../lib/sync'

export function ago(t?: number, now = Date.now()): string {
  if (!t) return 'never'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : new Date(t).toLocaleDateString('en-KE', { dateStyle: 'medium' })
}

/** One line describing the sync state, e.g. "Synced · 12s ago" or "3 changes waiting". */
export function syncLabel(s: SyncStatus, now = Date.now()): { text: string; tone: 'ok' | 'busy' | 'warn' | 'off' } {
  if (s.state === 'syncing') return { text: 'Syncing…', tone: 'busy' }
  if (s.state === 'offline') return { text: s.pending ? `Offline · ${s.pending} waiting` : 'Offline', tone: 'off' }
  if (s.state === 'signed-out') return { text: s.pending ? `Not connected · ${s.pending} waiting` : 'Not connected', tone: 'warn' }
  if (s.state === 'error') return { text: 'Sync problem', tone: 'warn' }
  if (s.pending) return { text: `${s.pending} change${s.pending === 1 ? '' : 's'} waiting`, tone: 'busy' }
  return { text: `Synced · ${ago(s.lastSync, now)}`, tone: 'ok' }
}

function useTick(ms = 10_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const DOT: Record<string, string> = { ok: 'bg-emerald-500', busy: 'bg-sky-500', warn: 'bg-amber-500', off: 'bg-slate-400' }

/** Compact chip for top bars; click to sync now, long label links to Settings → Sync. */
export function SyncChip({ dark = false }: { dark?: boolean }) {
  const s = useSyncStatus()
  const now = useTick()
  const { text, tone } = syncLabel(s, now)
  const Icon = s.state === 'syncing' ? Loader2 : s.state === 'offline' ? CloudOff : s.state === 'error' || s.state === 'signed-out' ? TriangleAlert : RefreshCw
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={s.error ? `${text} — ${s.error}. Click to retry.` : `${text}. Click to sync now.`}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
        dark ? 'bg-white/10 text-white/90 ring-1 ring-white/15 hover:bg-white/20' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]} ${tone === 'ok' ? '' : 'animate-pulse'}`} />
      <span className="hidden whitespace-nowrap md:inline">{text}</span>
      <Icon size={13} className={s.state === 'syncing' ? 'animate-spin' : ''} />
    </button>
  )
}

/** The sidebar card: shop + live sync line. */
export function SyncLine() {
  const s = useSyncStatus()
  const now = useTick()
  const { text, tone } = syncLabel(s, now)
  return (
    <Link to="/settings?tab=Sync" className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]} ${tone === 'ok' ? '' : 'animate-pulse'}`} />
      <span className="truncate">{text}</span>
    </Link>
  )
}
