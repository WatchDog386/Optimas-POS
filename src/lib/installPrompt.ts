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

  return { canInstall, installed, isIOS: ios(), install }
}
