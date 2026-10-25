import type { SyncStatus } from '../lib/sync'

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
