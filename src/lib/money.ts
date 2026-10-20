/** Convert a user-typed shilling amount ("1,250.50") to integer cents. */
export function toCents(input: string | number): number {
  if (typeof input === 'number') return Math.round(input * 100)
  const n = parseFloat(input.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function fromCents(cents: number): number {
  return cents / 100
}

const fmt = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtShort = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 })

export function money(cents: number, currency = 'KES'): string {
  const n = fmt.format(cents / 100)
  return currency ? `${currency} ${n}` : n
}

/** Compact amount without currency or decimals, for tiles and charts. */
export function moneyShort(cents: number): string {
  return fmtShort.format(cents / 100)
}
