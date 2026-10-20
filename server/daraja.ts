// Safaricom Daraja (M-Pesa) client: OAuth token, STK Push (Lipa Na M-Pesa Online) and STK query.
// Docs: https://developer.safaricom.co.ke

export interface StkCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID: string
      CheckoutRequestID: string
      ResultCode: number
      ResultDesc: string
      CallbackMetadata?: { Item: { Name: string; Value?: string | number }[] }
    }
  }
}

interface Env {
  MPESA_ENV?: string
  MPESA_CONSUMER_KEY?: string
  MPESA_CONSUMER_SECRET?: string
  MPESA_SHORTCODE?: string
  MPESA_PASSKEY?: string
  MPESA_TILL?: string
  MPESA_CALLBACK_URL?: string
}

export function darajaTimestamp(d = new Date()): string {
  // Daraja expects YYYYMMDDHHmmss in Kenyan time (EAT, UTC+3).
  const eat = new Date(d.getTime() + 3 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${eat.getUTCFullYear()}${p(eat.getUTCMonth() + 1)}${p(eat.getUTCDate())}${p(eat.getUTCHours())}${p(eat.getUTCMinutes())}${p(eat.getUTCSeconds())}`
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(shortcode + passkey + timestamp).toString('base64')
}

export function createDaraja(env: Env) {
  const configured = !!(env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_SHORTCODE && env.MPESA_PASSKEY && env.MPESA_CALLBACK_URL)
  const mode = env.MPESA_ENV === 'production' ? 'production' : 'sandbox'
  const base = mode === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
  // Buy Goods (till) uses the head-office store number as BusinessShortCode and the till as PartyB.
  const isTill = !!env.MPESA_TILL
  let token: { value: string; expires: number } | null = null

  async function accessToken(): Promise<string> {
    if (token && token.expires > Date.now()) return token.value
    const auth = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64')
    const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } })
    if (!res.ok) throw new Error(`Daraja auth failed (${res.status})`)
    const body = (await res.json()) as { access_token: string; expires_in: string }
    token = { value: body.access_token, expires: Date.now() + (Number(body.expires_in) - 60) * 1000 }
    return token.value
  }

  async function post<T>(pathname: string, payload: unknown): Promise<T> {
    const res = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as T & { errorMessage?: string }
    if (!res.ok) throw new Error(body.errorMessage ?? `Daraja error ${res.status}`)
    return body
  }

  return {
    configured,
    env: mode,

    stkPush(phone: string, amount: number, reference: string) {
      const timestamp = darajaTimestamp()
      return post<{ CheckoutRequestID: string; CustomerMessage: string; ResponseCode: string }>('/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: env.MPESA_SHORTCODE,
        Password: stkPassword(env.MPESA_SHORTCODE!, env.MPESA_PASSKEY!, timestamp),
        Timestamp: timestamp,
        TransactionType: isTill ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: phone,
        PartyB: isTill ? env.MPESA_TILL : env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: env.MPESA_CALLBACK_URL,
        AccountReference: reference.slice(0, 12),
        TransactionDesc: 'Parts purchase',
      })
    },

    stkQuery(checkoutRequestId: string) {
      const timestamp = darajaTimestamp()
      return post<{ ResultCode?: string; ResultDesc?: string }>('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: env.MPESA_SHORTCODE,
        Password: stkPassword(env.MPESA_SHORTCODE!, env.MPESA_PASSKEY!, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      })
    },
  }
}
