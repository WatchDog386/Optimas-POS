/** Darken a #RRGGBB hex colour toward black (f = 0 → black, f = 1 → unchanged). */
export function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Two-stop gradient matching the dashboard start cards (bright → dark). */
export function gradFrom(hex: string): string {
  return `linear-gradient(135deg, ${hex} 0%, ${shade(hex, 0.42)} 100%)`
}
