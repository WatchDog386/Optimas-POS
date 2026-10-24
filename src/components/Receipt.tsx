import { createPortal } from 'react-dom'
import type { Customer, Sale, Settings } from '../db/types'
import { money } from '../lib/money'

const METHOD_LABEL = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', account: 'On account' } as const

/**
 * On-screen / browser-print receipt. A full sales document: header, meta,
 * itemised table, totals block, payments and footer. Mirrors the ESC/POS
 * layout in lib/escpos.ts for thermal printing.
 */
export function Receipt({ sale, settings, cashier, customer }: { sale: Sale; settings: Settings; cashier?: string; customer?: Customer }) {
  const c = settings.currency
  const pieces = sale.lines.reduce((sum, l) => sum + l.qty, 0)
  return (
    <div
      className="receipt mx-auto bg-white p-3 text-[11.5px] leading-snug text-black"
      style={{ width: settings.paperWidth === 58 ? '54mm' : '78mm' }}
    >
      <header className="receipt-head">
        <h1>{settings.shopName}</h1>
        {settings.address && <p>{settings.address}</p>}
        {settings.phone && <p>Tel: {settings.phone}</p>}
        {settings.kraPin && <p>KRA PIN: {settings.kraPin}</p>}
        <p className="receipt-flag">{sale.refundOf ? 'REFUND RECEIPT' : 'SALES RECEIPT'}</p>
      </header>

      <div className="receipt-meta">
        <div>
          <span>Receipt</span>
          <b>{sale.receiptNo}</b>
        </div>
        <div>
          <span>Date</span>
          <b>{new Date(sale.createdAt).toLocaleString('en-KE')}</b>
        </div>
        {cashier && (
          <div>
            <span>Served by</span>
            <b>{cashier}</b>
          </div>
        )}
        {customer && (
          <div>
            <span>Customer</span>
            <b>{customer.name}</b>
          </div>
        )}
      </div>

      <table className="receipt-items">
        <thead>
          <tr>
            <th className="qty">Qty</th>
            <th>Item</th>
            <th className="num">Unit</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l, i) => (
            <tr key={i}>
              <td className="qty">{l.qty}</td>
              <td>
                <div className="name">{l.name}</div>
                {(l.sku || l.serial) && (
                  <div className="sub">
                    {l.sku}
                    {l.serial ? ` · S/N ${l.serial}` : ''}
                  </div>
                )}
                {l.discount > 0 && <div className="sub">Discount −{money(l.discount, '')}</div>}
              </td>
              <td className="num">{money(l.unitPrice, '')}</td>
              <td className="num strong">{money(l.qty * l.unitPrice - l.discount, '')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              {sale.lines.length} line{sale.lines.length === 1 ? '' : 's'} · {pieces} pc{pieces === 1 ? '' : 's'}
            </td>
            <td className="sub" colSpan={2}>
              Subtotal
            </td>
          </tr>
          <tr className="subtotal-row">
            <td colSpan={2}></td>
            <td colSpan={2} className="num strong">
              {money(sale.subtotal, c)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="receipt-totals">
        {sale.discount !== 0 && (
          <div>
            <span>Discount</span>
            <b>−{money(sale.discount, c)}</b>
          </div>
        )}
        <div>
          <span>
            VAT {settings.vatRate}%{settings.pricesIncludeVat ? ' (incl.)' : ''}
          </span>
          <b>{money(sale.tax, c)}</b>
        </div>
        <div className="receipt-total">
          <span>TOTAL</span>
          <b>{money(sale.total, c)}</b>
        </div>
      </div>

      <div className="receipt-payments">
        <div className="receipt-sec-title">Payments</div>
        {sale.payments.map((p, i) => (
          <div key={i} className="receipt-pay">
            <span>
              {METHOD_LABEL[p.method]}
              {p.reference && <small> {p.reference}</small>}
            </span>
            <b>{money(p.amount, c)}</b>
          </div>
        ))}
        {sale.change > 0 && (
          <div className="receipt-pay receipt-change">
            <span>Change</span>
            <b>{money(sale.change, c)}</b>
          </div>
        )}
        {settings.mpesaTill && (
          <div className="receipt-till">
            M-Pesa Till: <b>{settings.mpesaTill}</b>
          </div>
        )}
      </div>

      <footer className="receipt-foot">
        {settings.receiptFooter && <p>{settings.receiptFooter}</p>}
        <p className="receipt-thanks">Thank you for your business!</p>
      </footer>
    </div>
  )
}

/** Renders children into the hidden #print-root used by the @media print stylesheet. */
export function PrintPortal({ children }: { children: React.ReactNode }) {
  let root = document.getElementById('print-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'print-root'
    document.body.appendChild(root)
  }
  return createPortal(children, root)
}
