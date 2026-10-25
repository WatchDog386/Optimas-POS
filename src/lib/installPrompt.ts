import { useEffect, useState } from 'react'

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

function standalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

function ios(): boolean {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/**
 * How to install when the browser hasn't offered its own prompt (already
 * dismissed, Safari, Firefox…). Empty when the app is already installed.
 */
export function installHint(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/iphone|ipad|ipod/i.test(ua)) return 'On iPhone/iPad: tap Share → Add to Home Screen.'
  if (/android/i.test(ua)) return 'In Chrome: tap the ⋮ menu → Install app (or Add to Home screen).'
  if (/edg\//i.test(ua)) return 'In Edge: click the ⋯ menu → Apps → Install Optimas POS (or the install icon at the right of the address bar).'
  if (/firefox\//i.test(ua)) return 'Firefox cannot install apps on desktop. Open this page in Chrome or Edge, then click Install app.'
  if (/chrome\//i.test(ua)) return 'In Chrome: click the install icon at the right of the address bar, or ⋮ menu → Cast, save and share → Install page as app.'
  if (/safari\//i.test(ua) && /macintosh/i.test(ua)) return 'In Safari on Mac: File → Add to Dock.'
  return 'Open this page in Chrome or Edge and choose Install app from the browser menu.'
}

/** Manual "Install app" button state — Chrome/Edge prompt, iOS hint, installed flag. */
export function useInstall() {
  const [canInstall, setCanInstall] = useState(() => deferred !== null)
  const [installed, setInstalled] = useState(standalone)

  useEffect(() => {
    const update = () => {
      setCanInstall(deferred !== null)
      setInstalled(standalone())
    }
    listeners.add(update)
    update()
    return () => {
      listeners.delete(update)
    }
  }, [])

  const install = async () => {
    if (!deferred) return
    const d = deferred
    deferred = null
    emit()
    try {
      await d.prompt()
      await d.userChoice
    } catch {
      /* user dismissed or prompt unavailable — button state already refreshed */
    }
  }

  return { canInstall, installed, isIOS: ios(), install, hint: installHint() }
}
