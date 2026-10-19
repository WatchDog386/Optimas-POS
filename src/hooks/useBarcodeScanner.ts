import { useEffect, useRef } from 'react'

/**
 * USB/Bluetooth barcode scanners act as keyboards ("HID keyboard wedge"): they type the
 * code very fast and finish with Enter. We buffer keystrokes that arrive < 40ms apart and
 * fire onScan when Enter closes a burst of 4+ characters. Typing in normal inputs is
 * ignored unless the input opts in with data-scan="allow".
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const buf = useRef('')
  const last = useRef(0)
  const cb = useRef(onScan)
  cb.current = onScan

  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (inField && t?.dataset.scan !== 'allow') return

      const now = performance.now()
      if (now - last.current > 40) buf.current = ''
      last.current = now

      if (e.key === 'Enter') {
        if (buf.current.length >= 4) {
          e.preventDefault()
          cb.current(buf.current)
        }
        buf.current = ''
      } else if (e.key.length === 1) {
        buf.current += e.key
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [enabled])
}
