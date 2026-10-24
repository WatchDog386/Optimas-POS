import { useEffect, useRef, useState } from 'react'
import { Loader2, Smartphone, Trash2 } from 'lucide-react'
import { Modal, NumPad, errorText } from './ui'
import type { Customer, Payment, PaymentMethod, Settings } from '../db/types'
import { changeDue, paidAmount, quickCashOptions } from '../lib/cart'
import { money, toCents } from '../lib/money'
import { isValidMpesaCode, normalizePhone, stkPush, stkStatus } from '../lib/mpesa'

const METHODS: { id: PaymentMethod; label: string; img?: string }[] = [
  { id: 'cash', label: 'Cash', img: '/cash.png' },
  { id: 'mpesa', label: 'M-Pesa', img: '/mpesa.png' },
]

const CLOSED_LABELS: Partial<Record<PaymentMethod, string>> = { card: 'Card', account: 'On account' }

export default function PaymentModal({
  total,
  settings,
  customer,
  onClose,
  onComplete,
  initialMethod,
}: {
  total: number
  settings: Settings
  customer?: Customer
  onClose: () => void
  onComplete: (payments: Payment[]) => Promise<void>
  /** Tender tab to open on. Falls back to the first enabled method. */
  initialMethod?: PaymentMethod
}) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [method, setMethod] = useState<PaymentMethod>(initialMethod ?? 'cash')
  const [entry, setEntry] = useState('')
  const [reference, setReference] = useState('')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stk, setStk] = useState<{ id: string; message: string } | null>(null)

  const paid = paidAmount(payments)
  const remaining = Math.max(0, total - paid)
  const change = changeDue(total, payments)
  const done = paid >= total
  const amount = entry ? toCents(entry) : remaining
  const c = settings.currency

  const enabled = settings.enabledPayments?.length ? settings.enabledPayments : METHODS.map((m) => m.id)
  const methods = METHODS.filter((m) => enabled.includes(m.id))

  useEffect(() => {
    if (methods.length > 0 && !methods.some((m) => m.id === method)) setMethod(methods[0].id)
  }, [methods, method])

  useEffect(() => {
    setEntry('')
    setReference('')
    setError('')
  }, [method, payments.length])

  const add = (p: Payment) => {
    if (p.amount <= 0) return setError('Enter an amount')
    if (p.method !== 'cash' && p.amount > remaining) return setError('Only cash can be more than the amount due')
    setPayments((ps) => [...ps, p])
  }

  const addCurrent = () => {
    setError('')
    if (method === 'mpesa') {
      if (!isValidMpesaCode(reference)) return setError('M-Pesa code should be 10 letters/numbers, e.g. SJK7AB12CD')
      return add({ method, amount, reference: reference.trim().toUpperCase() })
    }
    add({ method, amount, reference: reference.trim() || undefined })
  }

  // --- M-Pesa STK push polling ---
  const pollRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearInterval(pollRef.current), [])

  const sendStk = async () => {
    setError('')
    const msisdn = normalizePhone(phone)
    if (!msisdn) return setError('Enter a valid Safaricom number, e.g. 0712 345 678')
    setBusy(true)
    try {
      const r = await stkPush(settings.apiUrl, msisdn, amount, settings.shopName.slice(0, 12))
      setStk({ id: r.checkoutRequestId, message: 'Prompt sent. Ask the customer to enter their M-Pesa PIN…' })
      const started = Date.now()
      const stkAmount = amount
      pollRef.current = window.setInterval(async () => {
        const s = await stkStatus(settings.apiUrl, r.checkoutRequestId)
        if (s.status === 'success') {
          window.clearInterval(pollRef.current)
          setStk(null)
          setPayments((ps) => [...ps, { method: 'mpesa', amount: stkAmount, reference: s.receipt }])
        } else if (s.status === 'failed' || Date.now() - started > 90_000) {
          window.clearInterval(pollRef.current)
          setStk(null)
          setError(s.message ?? 'No response from M-Pesa. Try again or enter the code manually.')
        }
      }, 3000)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    try {
      await onComplete(payments)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  const pad = (k: string) => {
    if (k === '⌫') setEntry((e) => e.slice(0, -1))
    else setEntry((e) => (e + k).replace(/^0+(?=\d)/, '').slice(0, 9))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (done) finish()
      else addCurrent()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal title="Take payment" onClose={busy ? () => {} : onClose} wide>
      <div className="pos-pay grid gap-6 md:grid-cols-[1fr_1.3fr]">
        {/* Summary */}
        <div className="flex flex-col">
          <div className="pos-pay-due">
            <div className="pos-pay-due-label">{done ? 'Paid in full' : 'Amount due'}</div>
            <div className="pos-pay-due-amount">{money(done ? total : remaining, c)}</div>
            {payments.length > 0 && !done && <div className="pos-pay-due-sub">of {money(total, c)}</div>}
            {change > 0 && <div className="pos-pay-change">Change {money(change, c)}</div>}
          </div>

          <div className="pos-pay-tenders custom-scrollbar">
            <div className="pos-pay-tenders-title">Tenders on this sale</div>
            {payments.length === 0 ? (
              <p>Split payments are supported — add as many tenders as needed.</p>
            ) : (
              payments.map((p, i) => {
                const entry = METHODS.find((m) => m.id === p.method) ?? {
                  id: p.method,
                  label: CLOSED_LABELS[p.method] ?? p.method,
                }
                return (
                  <div key={i} className="pos-pay-tender">
                    <span className="pos-pay-tender-mark">
                      {entry?.img ? <img src={entry.img} alt="" /> : null}
                    </span>
                    <span className="pos-pay-tender-info">
                      <b>{entry?.label}</b>
                      {p.reference && <small>{p.reference}</small>}
                    </span>
                    <span className="pos-pay-tender-amount">{money(p.amount, c)}</span>
                    <button
                      onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))}
                      className="pos-pay-tender-remove"
                      aria-label="Remove payment"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <button className="pos-pay-complete" disabled={!done || busy} onClick={finish}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {done ? 'Complete sale' : `Remaining ${money(remaining, c)}`}
          </button>
          {error && <p className="pos-pay-error">{error}</p>}
        </div>

        {/* Tender entry */}
        <div className={done ? 'pointer-events-none opacity-40' : ''}>
          <div className={`pos-pay-methods ${methods.length === 2 ? 'is-two' : methods.length === 3 ? 'is-three' : ''}`}>
            {methods.map(({ id, label, img }) => (
              <button
                key={id}
                onClick={() => setMethod(id)}
                className={`pos-pay-method pos-pay-method-${id} ${method === id ? 'is-active' : ''}`}
              >
                {img ? <img src={img} alt="" /> : <span className="pos-pay-method-fallback">{label.slice(0, 1)}</span>}
                <span>{label}</span>
              </button>
            ))}
          </div>

          <label className="label pos-pay-label">Amount</label>
          <div className="pos-pay-amount">
            {entry ? money(toCents(entry), c) : <span className="pos-pay-amount-empty">{money(remaining, c)}</span>}
          </div>

          {method === 'cash' && (
            <div className="pos-pay-quick">
              {quickCashOptions(remaining).map((v) => (
                <button key={v} className="pos-pay-quick-note" onClick={() => add({ method: 'cash', amount: v })}>
                  {money(v, '')}
                </button>
              ))}
            </div>
          )}

          {method === 'mpesa' && settings.mpesaMode === 'stk' && (
            <div className="pos-pay-fields">
              <input className="input" placeholder="Customer phone, e.g. 0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button className="pos-pay-mpesa-btn" onClick={sendStk} disabled={busy || !!stk}>
                {stk ? <Loader2 className="animate-spin" size={18} /> : <Smartphone size={18} />}
                {stk ? 'Waiting for customer…' : `Send M-Pesa prompt for ${money(amount, c)}`}
              </button>
              {stk && <p className="pos-pay-hint">{stk.message}</p>}
              <p className="pos-pay-note">Or type the confirmation code from the customer's SMS:</p>
            </div>
          )}
          {method === 'mpesa' && (
            <div className="pos-pay-fields">
              {settings.mpesaTill && settings.mpesaMode === 'manual' && (
                <p className="pos-pay-till">
                  Customer pays to Till <b>{settings.mpesaTill}</b>. Check the SMS, then enter the code.
                </p>
              )}
              <input
                className="input pos-pay-input-mono"
                placeholder="M-Pesa code, e.g. SJK7AB12CD"
                value={reference}
                maxLength={10}
                onChange={(e) => setReference(e.target.value.toUpperCase())}
              />
            </div>
          )}

          <NumPad onKey={pad} />
          <button className="pos-pay-add" onClick={addCurrent}>
            Add {METHODS.find((m) => m.id === method)?.label} {money(amount, c)}
          </button>
        </div>
      </div>
    </Modal>
  )
}
