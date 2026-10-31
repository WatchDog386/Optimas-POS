// New parts are numbered 0001, 0002, 0003… for both SKU and part number.

export const DEFAULT_BRAND = 'Spiro'

/** Next free number after the highest all-digit code, zero-padded to 4 digits (0001). */
export function nextNumber(codes: (string | undefined)[]): string {
  const taken = new Set(codes.map((c) => c?.trim()))
  let n = Math.max(0, ...codes.map((c) => c?.trim() ?? '').filter((c) => /^\d+$/.test(c)).map(Number)) + 1
  while (taken.has(String(n).padStart(4, '0'))) n++
  return String(n).padStart(4, '0')
}
