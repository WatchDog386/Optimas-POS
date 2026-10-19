import { useEffect, useRef, useState } from 'react'
import { Banknote, CreditCard, Loader2, Smartphone, Trash2, UserRound } from 'lucide-react'
import { Modal, NumPad, errorText } from './ui'
import type { Customer, Payment, PaymentMethod, Settings } from '../db/types'
import { changeDue, paidAmount, quickCashOptions } from '../lib/cart'
import { money, toCents } from '../lib/money'
import { isValidMpesaCode, normalizePhone, stkPush, stkStatus } from '../lib/mpesa'

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'mpesa', label: 'M-Pesa', icon: Smartphone },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'account', label: 'On account', icon: UserRound },
]

export default function PaymentModal({
  total,
  settings,
  customer,
  onClose,
  onComplete,
}: {
  total: number
  settings: Settings
  customer?: Customer
  onClose: () => void
  onComplete: (payments: Payment[]) => Promise<void>
}) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [method, setMethod] = useState<PaymentMethod>('cash')
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
    if (method === 'account') {
      if (!customer) return setError('Attach a customer to the sale first')
      const after = customer.balance + amount
      if (customer.creditLimit > 0 && after > customer.creditLimit) {
        return setError(`Over credit limit (${money(customer.creditLimit, c)})`)
      }
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
      <div className="grid gap-5 md:grid-cols-[1fr_1.3fr]">
        {/* Summary */}
        <div className="flex flex-col">
          <div className="rounded-xl bg-slate-950 p-4 text-white">
            <div className="text-xs uppercase tracking-wide text-slate-400">{done ? 'Paid' : 'Amount due'}</div>
            <div className="text-3xl font-black">{money(done ? total : remaining, c)}</div>
            {payments.length > 0 && !done && <div className="mt-1 text-sm text-slate-400">of {money(total, c)}</div>}
            {change > 0 && <div className="mt-2 text-xl font-bold text-brand-400">Change {money(change, c)}</div>}
          </div>
          <div className="mt-3 flex-1 space-y-2">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold">{METHODS.find((m) => m.id === p.method)?.label}</div>
                  {p.reference && <div className="text-xs text-slate-500">{p.reference}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{money(p.amount, c)}</span>
                  <button onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label="Remove payment">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {payments.length === 0 && <p className="text-sm text-slate-500">Split payments are supported — add as many tenders as needed.</p>}
          </div>
          <button className="btn-primary mt-4 h-14 text-lg" disabled={!done || busy} onClick={finish}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {done ? 'Complete sale' : `Remaining ${money(remaining, c)}`}
          </button>
          {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
        </div>

        {/* Tender entry */}
        <div className={done ? 'pointer-events-none opacity-40' : ''}>
          <div className="mb-3 grid grid-cols-4 gap-2">
            {METHODS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setMethod(id)}
                className={`flex flex-col items-center gap-1 rounded-xl border py-3 text-xs font-semibold ${
                  method === id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'
                }`}
              >
                <Icon size={20} />
                {label}
              </button>
            ))}
          </div>

          <label className="label">Amount</label>
          <div className="mb-3 rounded-lg border border-slate-300 px-3 py-2 text-right text-2xl font-bold">
            {entry ? money(toCents(entry), c) : <span className="text-slate-400">{money(remaining, c)}</span>}
          </div>

          {method === 'cash' && (
            <div className="mb-3 grid grid-cols-4 gap-2">
              {quickCashOptions(remaining).map((v) => (
                <button key={v} className="btn-ghost px-2" onClick={() => add({ method: 'cash', amount: v })}>
                  {money(v, '')}
                </button>
              ))}
            </div>
          )}

          {method === 'mpesa' && settings.mpesaMode === 'stk' && (
            <div className="mb-3 space-y-2">
              <input className="input" placeholder="Customer phone, e.g. 0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button className="btn-dark w-full" onClick={sendStk} disabled={busy || !!stk}>
                {stk ? <Loader2 className="animate-spin" size={16} /> : <Smartphone size={16} />}
                {stk ? 'Waiting for customer…' : `Send M-Pesa prompt for ${money(amount, c)}`}
              </button>
              {stk && <p className="text-sm text-slate-600">{stk.message}</p>}
              <p className="text-xs text-slate-500">Or type the confirmation code from the customer's SMS:</p>
            </div>
          )}
          {method === 'mpesa' && (
            <div className="mb-3">
              {settings.mpesaTill && settings.mpesaMode === 'manual' && (
                <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Customer pays to Till <b>{settings.mpesaTill}</b>. Check the SMS, then enter the code.
                </p>
              )}
              <input
                className="input font-mono uppercase"
                placeholder="M-Pesa code, e.g. SJK7AB12CD"
                value={reference}
                maxLength={10}
                onChange={(e) => setReference(e.target.value.toUpperCase())}
              />
            </div>
          )}
          {method === 'card' && (
            <input className="input mb-3" placeholder="Approval code from card terminal (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
          )}
          {method === 'account' && (
            <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              {customer ? (
                <>
                  <b>{customer.name}</b> currently owes {money(customer.balance, c)}
                  {customer.creditLimit > 0 && <> · limit {money(customer.creditLimit, c)}</>}
                </>
              ) : (
                <span className="text-red-600">Attach a customer to the sale to sell on account.</span>
              )}
            </div>
          )}

          <NumPad onKey={pad} />
          <button className="btn-dark mt-3 h-12 w-full" onClick={addCurrent}>
            Add {METHODS.find((m) => m.id === method)?.label} {money(amount, c)}
          </button>
        </div>
      </div>
    </Modal>
  )
}
