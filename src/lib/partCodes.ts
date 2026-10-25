// Suggests the next SKU / part number by following the way codes are already
// keyed in: the pattern of the most recently added part wins, e.g. after
// "SPR-0041" comes "SPR-0042", after "BRK12A" comes "BRK13A".

export const DEFAULT_BRAND = 'Spiro'
export const DEFAULT_SKU = 'SPR-0001'
export const DEFAULT_PART_NUMBER = 'SPR-PN-0001'

const PATTERN = /^(.*?)(\d+)(\D*)$/

/**
 * @param codes existing codes, newest first (blank entries are ignored)
 * @param fallback used when no existing code ends in a number
 */
export function nextCode(codes: (string | undefined)[], fallback: string): string {
  const parsed = codes
    .map((c) => c?.trim().toUpperCase().match(PATTERN))
    .filter((m): m is RegExpMatchArray => !!m)
  if (!parsed.length) return fallback
  const [, prefix, , suffix] = parsed[0]
  const same = parsed.filter((m) => m[1] === prefix && m[3] === suffix)
  const max = Math.max(...same.map((m) => Number(m[2])))
  const width = Math.max(...same.map((m) => m[2].length))
  const taken = new Set(codes.map((c) => c?.trim().toUpperCase()))
  for (let n = max + 1; ; n++) {
    const code = `${prefix}${String(n).padStart(width, '0')}${suffix}`
    if (!taken.has(code)) return code
  }
}
