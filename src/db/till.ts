// Identity of this till within the shop, and IDs that are unique across tills.
//
// Every till numbers its own records, so plain auto-increment IDs would clash
// as soon as two tills sync. New records instead get a time-ordered ID that
// also encodes the till: (ms since 2026-01-01) × 2048 + till × 32 + sequence.
// That stays a safe JavaScript integer for well over a century.

export const ID_EPOCH = Date.UTC(2026, 0, 1)
export const MAX_TILL = 63

let till = 0
let lastMs = 0
let seq = 0

export function currentTill(): number {
  return till
}

export function setCurrentTill(n: number) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_TILL) throw new Error(`Till number must be 0–${MAX_TILL}`)
  till = n
}

export function randomTill(): number {
  return 1 + Math.floor(Math.random() * MAX_TILL)
}

/** A new primary key, unique across tills and increasing over time. */
export function newId(now = Date.now()): number {
  let ms = Math.max(0, now - ID_EPOCH)
  if (ms < lastMs) ms = lastMs
  if (ms === lastMs) {
    seq++
    if (seq > 31) {
      ms = lastMs + 1
      seq = 0
    }
  } else seq = 0
  lastMs = ms
  return ms * 2048 + till * 32 + seq
}

/** Two-digit till part of document numbers: R07-000123. */
export function tillTag(): string {
  return String(till).padStart(2, '0')
}
