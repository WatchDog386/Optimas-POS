import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MessageCircle, Printer } from 'lucide-react'
import { Modal, errorText, useToast } from './ui'
import { PrintPortal, Receipt } from './Receipt'
import { db } from '../db/db'
import type { Sale, Settings } from '../db/types'
import { printReceipt } from '../lib/printReceipt'
import { money } from '../lib/money'
import { normalizePhone } from '../lib/mpesa'

export default function ReceiptModal({
  sale,
  settings,
  onClose,
  isNew,
  actions,
  autoPrint,
}: {
  sale: Sale
  settings: Settings
  onClose: () => void
  isNew?: boolean
  /** Extra footer buttons, e.g. Refund from sales history. */
  actions?: ReactNode
  /** Force auto-print after the sale completes, overriding the shop setting. */
  autoPrint?: boolean
}) {
  const toast = useToast()
  const cashier = useLiveQuery(() => db.users.get(sale.userId), [sale.userId])
  const customer = useLiveQuery(() => (sale.customerId ? db.customers.get(sale.customerId) : undefined), [sale.customerId])
  const [printing, setPrinting] = useState(false)

  const print = async (copy: boolean) => {
    setPrinting(true)
    try {
      const sent = await printReceipt(sale, settings, { copy })
      if (!sent) window.print()
    } catch (e) {
      toast(`${errorText(e)} — using browser print`, 'error')
      window.print()
    } finally {
      setPrinting(false)
    }
  }

  // Auto-print once when a fresh sale opens (the ref guards against StrictMode double effects).
  const autoPrinted = useRef(false)
  useEffect(() => {
    if (!isNew || !(autoPrint ?? settings.autoPrint) || autoPrinted.current) return
    autoPrinted.current = true
    print(false)
  }, [])

  const whatsapp = () => {
    const lines = [
      `*${settings.shopName}*`,
      `Receipt ${sale.receiptNo} · ${new Date(sale.createdAt).toLocaleString('en-KE')}`,
      ...sale.lines.map((l) => `${l.qty} x ${l.name} = ${money(l.qty * l.unitPrice - l.discount, '')}`),
      `*TOTAL ${money(sale.total, settings.currency)}*`,
      settings.receiptFooter,
    ]
    const phone = customer?.phone ? normalizePhone(customer.phone) : null
    window.open(`https://wa.me/${phone ?? ''}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank')
  }

  return (
    <Modal
      title={isNew ? `Sale complete${sale.change ? ` · change ${money(sale.change, settings.currency)}` : ''}` : `Receipt ${sale.receiptNo}`}
      onClose={onClose}
      footer={
        <>
          {actions}
          <button className="btn-ghost" onClick={whatsapp}>
            <MessageCircle size={16} /> WhatsApp
          </button>
          <button className="btn-ghost" onClick={() => print(!isNew)} disabled={printing}>
            <Printer size={16} /> {isNew ? 'Print' : 'Reprint'}
          </button>
          <button className="btn-primary" onClick={onClose} autoFocus>
            {isNew ? 'New sale' : 'Close'}
          </button>
        </>
      }
    >
      <div className="rounded-lg bg-slate-50 py-4">
        <Receipt sale={sale} settings={settings} cashier={cashier?.name} customer={customer} />
      </div>
      <PrintPortal>
        <Receipt sale={sale} settings={settings} cashier={cashier?.name} customer={customer} />
      </PrintPortal>
    </Modal>
  )
}
