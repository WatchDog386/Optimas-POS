import { createPortal } from 'react-dom'
import type { Customer, Sale, Settings } from '../db/types'
import { money } from '../lib/money'

const METHOD_LABEL = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', account: 'On account' } as const

/** On-screen / browser-print receipt. Mirrors the ESC/POS layout in lib/escpos.ts. */
export function Receipt({ sale, settings, cashier, customer }: { sale: Sale; settings: Settings; cashier?: string; customer?: Customer }) {
  const c = settings.currency
  return (
    <div className="mx-auto font-mono text-[12px] leading-snug text-black" style={{ width: settings.paperWidth === 58 ? '48mm' : '72mm' }}>
      <div className="text-center">
        <div className="text-base font-bold">{settings.shopName}</div>
        {settings.address && <div>{settings.address}</div>}
        {settings.phone && <div>Tel: {settings.phone}</div>}
        {settings.kraPin && <div>KRA PIN: {settings.kraPin}</div>}
        {sale.refundOf && <div className="mt-1 font-bold">REFUND</div>}
      </div>
      <hr className="my-1 border-dashed border-black" />
      <div>Receipt: {sale.receiptNo}</div>
      <div>{new Date(sale.createdAt).toLocaleString('en-KE')}</div>
      {cashier && <div>Served by: {cashier}</div>}
      {customer && <div>Customer: {customer.name}</div>}
      <hr className="my-1 border-dashed border-black" />
      {sale.lines.map((l, i) => (
        <div key={i} className="mb-1">
          <div>{l.name}</div>
          <div className="flex justify-between pl-2">
            <span>
              {l.qty} × {money(l.unitPrice, '')}
              {l.discount ? ` −${money(l.discount, '')}` : ''}
            </span>
            <span>{money(l.qty * l.unitPrice - l.discount, '')}</span>
          </div>
          {(l.sku || l.serial) && (
            <div className="pl-2 text-[10px]">
              {l.sku}
              {l.serial && ` S/N ${l.serial}`}
            </div>
          )}
        </div>
      ))}
      <hr className="my-1 border-dashed border-black" />
      <Row k="Subtotal" v={money(sale.subtotal, c)} />
      {sale.discount !== 0 && <Row k="Discount" v={`−${money(sale.discount, c)}`} />}
      <Row k={`VAT ${settings.vatRate}%${settings.pricesIncludeVat ? ' (incl.)' : ''}`} v={money(sale.tax, c)} />
      <div className="my-1 flex justify-between text-base font-bold">
        <span>TOTAL</span>
        <span>{money(sale.total, c)}</span>
      </div>
      <hr className="my-1 border-dashed border-black" />
      {sale.payments.map((p, i) => (
        <Row key={i} k={`${METHOD_LABEL[p.method]}${p.reference ? ` ${p.reference}` : ''}`} v={money(p.amount, c)} />
      ))}
      {sale.change > 0 && <Row k="Change" v={money(sale.change, c)} />}
      {settings.mpesaTill && <div>M-Pesa Till: {settings.mpesaTill}</div>}
      <hr className="my-1 border-dashed border-black" />
      <div className="text-center">{settings.receiptFooter}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{k}</span>
      <span className="whitespace-nowrap">{v}</span>
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
