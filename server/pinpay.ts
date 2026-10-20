// M-Pesa prompting via the shop's PinnovaTech pay gateway:
//
//   POST https://optimus.pinnovatech.co.ke/optimus/pay   { phone, amount, reference }
//
// The gateway sends the STK prompt to the customer's phone; the till then polls
// our /api/mpesa/status/:id, which asks the gateway for the outcome and stores
// it in SQLite (server/migrations/001_init.sql).
//
// The gateway's exact JSON isn't hard-coded: transaction ids and statuses are
// read from the usual field names (transactionId, id, CheckoutRequestID, …) and
// everything is configurable in .env — see .env.example.

export type PayStatus = 'pending' | 'success' | 'failed'

export interface PromptResult {
  transactionId: string
  customerMessage?: string
  raw: unknown
}

export interface QueryInput {
  /** Id we handed to the till (mpesa_transactions.id). */
  id: string
  /** Id the gateway returned, when it gave one. */
  gatewayId?: string | null
  reference?: string | null
  phone: string
  amount: number
}

export interface QueryResult {
  status: PayStatus
  receipt?: string
  message?: string
  raw: unknown
}

/** Read lazily: server/index.ts loads .env after the module graph is imported. */
const env = () => process.env

const trim = (u: string) => u.replace(/\/+$/, '')

export function payEndpoint(): string {
  return trim(env().PAY_ENDPOINT ?? '')
}

export function payStatusEndpoint(): string {
  const status = env().PAY_STATUS_ENDPOINT
  return trim(status && status.length > 0 ? status : env().PAY_ENDPOINT ?? '')
}

export function payConfigured(): boolean {
  return payEndpoint().length > 0
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  const token = env().PAY_AUTH_TOKEN
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

// --- tolerant JSON helpers --------------------------------------------------

type Json = Record<string, unknown>

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** First value found under one of `keys`, searching the object and its `data`/`result` wrappers. */
function pick(src: unknown, keys: string[]): unknown {
  if (!isObj(src)) return undefined
  const layers: unknown[] = [src]
  for (const wrap of ['data', 'result', 'payload']) {
    if (isObj(src[wrap])) layers.push(src[wrap])
  }
  for (const layer of layers) {
    if (!isObj(layer)) continue
    for (const k of keys) {
      if (layer[k] !== undefined && layer[k] !== null && layer[k] !== '') return layer[k]
    }
    // case-insensitive fallback
    for (const k of Object.keys(layer)) {
      const lower = k.toLowerCase()
      if (keys.some((want) => want.toLowerCase() === lower)) {
        const v = layer[k]
        if (v !== undefined && v !== null && v !== '') return v
      }
    }
  }
  return undefined
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return undefined
}

const ID_KEYS = [
  'transactionId', 'transaction_id', 'transactionID', 'txnId', 'txn_id',
  'CheckoutRequestID', 'checkoutRequestId', 'checkout_request_id',
  'requestId', 'request_id', 'RequestID', 'id', 'Id', 'ID',
]

function parseStatus(v: unknown): PayStatus {
  if (v === undefined || v === null || v === '') return 'pending'
  if (typeof v === 'number') return v === 0 ? 'success' : 'failed'
  const s = String(v).trim().toLowerCase()
  if (['0', 'success', 'successful', 'completed', 'complete', 'paid', 'confirmed', 'ok', 'processed'].includes(s)) return 'success'
  if (['1', 'failed', 'fail', 'failure', 'error', 'cancelled', 'canceled', 'declined', 'timeout', 'expired'].includes(s)) return 'failed'
  return 'pending'
}

// --- gateway calls ----------------------------------------------------------

/** Ask the gateway to prompt the customer's phone (phone + amount). */
export async function promptPayment(phone: string, amountShillings: number, reference: string): Promise<PromptResult> {
  const url = payEndpoint()
  if (!url) throw new Error('PAY_ENDPOINT is not configured in .env')
  const body = { phone, amount: amountShillings, reference }
  const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON reply — handled below */
  }
  if (!res.ok) {
    const msg = str(pick(json, ['error', 'message', 'msg', 'detail'])) ?? `Pay gateway error (${res.status})`
    throw new Error(msg)
  }
  // No id in the reply? mint a local one — the status call still carries the
  // reference/phone/amount so the gateway can match it on its side.
  const gatewayId = str(pick(json, ID_KEYS))
  const transactionId = gatewayId ?? `PIN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  return {
    transactionId,
    customerMessage: str(pick(json, ['customerMessage', 'CustomerMessage', 'message', 'msg'])),
    raw: json ?? text,
  }
}

/** Ask the gateway whether the prompted payment has landed. */
export async function queryPayment(q: QueryInput): Promise<QueryResult> {
  const url = payStatusEndpoint()
  if (!url) throw new Error('PAY_ENDPOINT is not configured in .env')
  const target = q.gatewayId ?? q.id
  const payload = {
    transactionId: target,
    id: target,
    reference: q.reference ?? undefined,
    phone: q.phone,
    amount: q.amount,
    action: 'status',
  }
  const method = (env().PAY_STATUS_METHOD ?? 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST'
  let res: Response
  if (method === 'GET') {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(payload)) if (v !== undefined) qs.set(k, String(v))
    res = await fetch(`${url}?${qs.toString()}`, { headers: headers() })
  } else {
    res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(payload) })
  }

  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    // Still processing (or the endpoint doesn't know this id yet) — keep polling.
    return { status: 'pending', raw: json ?? text }
  }
  const status = parseStatus(pick(json, ['status', 'state', 'result', 'ResultCode', 'resultCode', 'paymentStatus']))
  const receipt = str(pick(json, ['receipt', 'mpesaReceipt', 'mpesaReceiptNumber', 'MpesaReceiptNumber', 'confirmationCode', 'transactionReceipt']))
  const message = str(pick(json, ['message', 'msg', 'ResultDesc', 'resultDesc', 'description', 'error']))
  return { status, receipt, message, raw: json ?? text }
}
