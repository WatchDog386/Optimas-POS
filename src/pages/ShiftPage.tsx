import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownToLine, ArrowUpFromLine, Lock, Printer, Unlock } from 'lucide-react'
import { db } from '../db/db'
import { useSettings } from '../db/settings'
import { addCashMovement, closeShift, openShift, summarizeShift, type ShiftSummary } from '../db/shifts'
import type { Sale, Shift } from '../db/types'
import { money, toCents } from '../lib/money'
import { EscPos, columnsFor } from '../lib/escpos'
import { loadPrinterConfig, sendRaw } from '../lib/printer'
import { openDrawer } from '../lib/printReceipt'
import { useSession } from '../session'
import { ListPanel, Modal, PageHeader, errorText, useToast } from '../components/ui'
import { OpenShiftModal } from './SellPage'

export default function ShiftPage() {
  const settings = useSettings()
  const { user, shift } = useSession()
  const toast = useToast()
  const [dialog, setDialog] = useState<'open' | 'in' | 'out' | 'close' | null>(null)
  const sales = useLiveQuery(() => (shift ? db.sales.where('shiftId').equals(shift.id!).toArray() : []), [shift?.id], [] as Sale[])
  const history = useLiveQuery(() => db.shifts.orderBy('openedAt').reverse().limit(15).toArray(), [], [] as Shift[])
  const users = useLiveQuery(() => db.users.toArray(), [], [])
  const userName = Object.fromEntries(users.map((u) => [u.id, u.name]))
  const summary = shift ? summarizeShift(shift, sales) : null
  const c = settings.currency

  const drawer = async () => {
    try {
      await openDrawer(settings)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Shift & cash drawer"
        subtitle="Open with a float, record cash in/out, and cash up at the end of the day"
        actions={
          shift ? (
            <>
              <button className="btn-ghost" onClick={drawer}>
                Open drawer
              </button>
              <button className="btn-ghost" onClick={() => setDialog('in')}>
                <ArrowDownToLine size={16} /> Cash in
              </button>
              <button className="btn-ghost" onClick={() => setDialog('out')}>
                <ArrowUpFromLine size={16} /> Cash out
              </button>
              <button className="btn-dark" onClick={() => setDialog('close')}>
                <Lock size={16} /> Close shift
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => setDialog('open')}>
              <Unlock size={16} /> Open shift
            </button>
          )
        }
      />

      {shift && summary ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            <div className="mb-4 text-sm text-slate-500">
              Opened by {userName[shift.userId]} at {new Date(shift.openedAt).toLocaleString('en-KE')}
            </div>
            <SummaryTable summary={summary} float={shift.openingFloat} currency={c} />
          </div>
          <div className="card p-5">
            <h2 className="mb-2 font-semibold">Cash movements</h2>
            {shift.cashMovements.length === 0 && <p className="text-sm text-slate-500">None yet. Use Cash out for petty cash, banking or supplier payments.</p>}
            {shift.cashMovements.map((m, i) => (
              <div key={i} className="flex justify-between border-b border-slate-100 py-1.5 text-sm">
                <span>
                  {m.reason}
                  <span className="block text-xs text-slate-500">{new Date(m.at).toLocaleTimeString('en-KE')}</span>
                </span>
                <span className={m.type === 'in' ? 'text-emerald-700' : 'text-red-600'}>
                  {m.type === 'in' ? '+' : '−'}
                  {money(m.amount, '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card p-10 text-center text-slate-500">No shift is open. Open one with your starting cash float before selling.</div>
      )}

      <div className="mt-8">
        <ListPanel title="Recent shifts" barClassName="hidden sm:flex" footer={<span>{history.length} shift{history.length === 1 ? '' : 's'}</span>}>
          <table className="w-full">
            <thead className="table-head">
              <tr>
                <th>Opened</th>
                <th>Closed</th>
                <th>By</th>
                <th className="text-right">Expected cash</th>
                <th className="text-right">Counted</th>
                <th className="text-right">Over / short</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => {
                const diff = s.countedCash !== undefined && s.expectedCash !== undefined ? s.countedCash - s.expectedCash : undefined
                return (
                  <tr key={s.id} className="table-row">
                    <td>{new Date(s.openedAt).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{s.closedAt ? new Date(s.closedAt).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' }) : 'open'}</td>
                    <td>{userName[s.userId]}</td>
                    <td className="text-right">{s.expectedCash !== undefined ? money(s.expectedCash, '') : '—'}</td>
                    <td className="text-right">{s.countedCash !== undefined ? money(s.countedCash, '') : '—'}</td>
                    <td className={`text-right font-semibold ${diff === undefined ? '' : diff < 0 ? 'text-red-600' : diff > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {diff === undefined ? '—' : `${diff > 0 ? '+' : ''}${money(diff, '')}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ListPanel>
      </div>

      {dialog === 'open' && (
        <OpenShiftModal
          onClose={() => setDialog(null)}
          onOpen={async (float) => {
            await openShift(user!.id!, float)
            setDialog(null)
          }}
        />
      )}
      {(dialog === 'in' || dialog === 'out') && shift && <CashMoveModal type={dialog} shiftId={shift.id!} onClose={() => setDialog(null)} />}
      {dialog === 'close' && shift && summary && <CloseShiftModal shift={shift} summary={summary} onClose={() => setDialog(null)} />}
    </div>
  )
}

function SummaryTable({ summary, float, currency }: { summary: ShiftSummary; float: number; currency: string }) {
  const rows: [string, number, string?][] = [
    ['Sales', summary.sales, `${summary.transactions} transactions`],
    ['Refunds', summary.refunds],
    ['M-Pesa', summary.byMethod.mpesa],
    ['Card', summary.byMethod.card],
    ['On account', summary.byMethod.account],
    ['VAT', summary.tax],
  ]
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <dl className="space-y-1.5 text-sm">
        {rows.map(([k, v, sub]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-slate-600">
              {k}
              {sub && <span className="ml-1 text-xs text-slate-400">({sub})</span>}
            </dt>
            <dd className="whitespace-nowrap font-semibold">{money(v, currency)}</dd>
          </div>
        ))}
      </dl>
      <dl className="space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between">
          <dt>Opening float</dt>
          <dd>{money(float, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>+ Cash sales (net of change & refunds)</dt>
          <dd className="whitespace-nowrap">{money(summary.byMethod.cash, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>+ Cash in</dt>
          <dd>{money(summary.cashIn, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>− Cash out</dt>
          <dd>{money(summary.cashOut, currency)}</dd>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-bold">
          <dt>Expected in drawer</dt>
          <dd>{money(summary.expectedCash, currency)}</dd>
        </div>
      </dl>
    </div>
  )
}

function CashMoveModal({ type, shiftId, onClose }: { type: 'in' | 'out'; shiftId: number; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const save = async () => {
    if (toCents(amount) <= 0 || !reason.trim()) return
    await addCashMovement(shiftId, type, toCents(amount), reason.trim())
    onClose()
  }
  return (
    <Modal title={type === 'in' ? 'Cash in' : 'Cash out'} onClose={onClose} footer={<button className="btn-primary" onClick={save}>Save</button>}>
      <label className="label">Amount (KES)</label>
      <input className="input mb-3 text-lg" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      <label className="label">Reason</label>
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'in' ? 'e.g. extra change from bank' : 'e.g. lunch, transport, paid supplier, banked'} />
    </Modal>
  )
}

function CloseShiftModal({ shift, summary, onClose }: { shift: Shift; summary: ShiftSummary; onClose: () => void }) {
  const settings = useSettings()
  const toast = useToast()
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const diff = toCents(counted) - summary.expectedCash

  const printZ = async (countedCash: number) => {
    const cfg = loadPrinterConfig()
    if (cfg.mode === 'browser') return
    const amt = (v: number) => money(v, '')
    const p = new EscPos(columnsFor(settings.paperWidth)).init()
    p.align('center').bold(true).line('Z REPORT – SHIFT CLOSE').bold(false).line(settings.shopName).align('left').rule()
    p.line(`Opened: ${new Date(shift.openedAt).toLocaleString('en-KE')}`)
    p.line(`Closed: ${new Date().toLocaleString('en-KE')}`).rule()
    p.pair('Sales', amt(summary.sales)).pair('Transactions', String(summary.transactions)).pair('Refunds', amt(summary.refunds))
    p.pair('M-Pesa', amt(summary.byMethod.mpesa)).pair('Card', amt(summary.byMethod.card)).pair('On account', amt(summary.byMethod.account))
    p.pair('VAT', amt(summary.tax)).rule()
    p.pair('Float', amt(shift.openingFloat)).pair('Cash sales', amt(summary.byMethod.cash))
    p.pair('Cash in', amt(summary.cashIn)).pair('Cash out', amt(summary.cashOut))
    p.bold(true).pair('Expected', amt(summary.expectedCash)).pair('Counted', amt(countedCash)).pair('Over/short', amt(countedCash - summary.expectedCash)).bold(false)
    p.feed(3).cut()
    await sendRaw(p.build(), cfg, settings.apiUrl)
  }

  const close = async () => {
    try {
      const cents = toCents(counted)
      await closeShift(shift.id!, cents, notes || undefined)
      await printZ(cents).catch((e) => toast(`Z report not printed: ${errorText(e)}`, 'error'))
      toast('Shift closed')
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <Modal
      title="Close shift (cash up)"
      onClose={onClose}
      footer={
        <button className="btn-dark" onClick={close} disabled={counted === ''}>
          <Printer size={16} /> Close shift & print Z report
        </button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">Count every note and coin in the drawer, then enter the total. Do this blind — the expected figure is shown after you type.</p>
      <label className="label">Counted cash (KES)</label>
      <input className="input mb-3 text-2xl" inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
      {counted !== '' && (
        <div className={`mb-3 rounded-lg p-3 text-sm ${diff === 0 ? 'bg-navy-50 text-navy-800' : diff < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
          Expected {money(summary.expectedCash)} · {diff === 0 ? 'Balanced ✓' : diff < 0 ? `Short by ${money(-diff)}` : `Over by ${money(diff)}`}
        </div>
      )}
      <label className="label">Notes</label>
      <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Modal>
  )
}
