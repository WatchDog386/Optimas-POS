// Client for the M-Pesa bridge in server/index.ts (Safaricom Daraja STK Push).
// Daraja credentials never reach the browser; the server holds them.

export type StkStatus = 'pending' | 'success' | 'failed'

export interface StkResult {
  status: StkStatus
  receipt?: string
  message?: string
}

/** Normalise 07xx / 01xx / +254 numbers to the 2547xxxxxxxx format Daraja expects. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (/^254[17]\d{8}$/.test(digits)) return digits
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1)
  if (/^[17]\d{8}$/.test(digits)) return '254' + digits
  return null
}

/** M-Pesa confirmation codes are 10 upper-case alphanumerics, e.g. SJK7XXXXXX. */
export function isValidMpesaCode(code: string): boolean {
  return /^[A-Z0-9]{10}$/.test(code.trim().toUpperCase())
}

export async function stkPush(apiUrl: string, phone: string, amountCents: number, reference: string) {
  const res = await fetch(`${apiUrl}/mpesa/stkpush`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Daraja only accepts whole shillings.
    body: JSON.stringify({ phone, amount: Math.ceil(amountCents / 100), reference }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `STK push failed (${res.status})`)
  return body as { checkoutRequestId: string; customerMessage?: string }
}

export async function stkStatus(apiUrl: string, checkoutRequestId: string): Promise<StkResult> {
  const res = await fetch(`${apiUrl}/mpesa/status/${encodeURIComponent(checkoutRequestId)}`)
  if (!res.ok) return { status: 'pending' }
  return (await res.json()) as StkResult
}
