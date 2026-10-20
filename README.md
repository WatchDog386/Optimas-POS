# Optimas POS

Point-of-sale and inventory system for a **motorbike / e-bike spare parts shop** in Kenya. It works offline, takes M-Pesa, cash, card and credit payments, and drives standard receipt-printer hardware.

![Sell screen](docs/screenshots/sell.png)

## What it does

| Area | Features |
|---|---|
| **Sell** | Tap-to-add product grid with colour-coded categories. Search by name, SKU, OEM part number or barcode. A **"Fits bike model" filter** shows only parts for the customer's bike. Barcode scanner support, park/resume sales, cart and line discounts, custom/labour items, serial capture for batteries, controllers and chargers. Keyboard shortcuts (F2 search, F4 customer, F8 park, F9 charge). |
| **Payments** | Cash with quick-note buttons and change. **M-Pesa** by manual code entry (no setup needed) or **STK Push** through Safaricom Daraja. Card by approval code from a standalone PDQ. On account (credit) with credit limits. Split tender. |
| **Receipts** | 58/80 mm ESC/POS printing over USB, Serial/Bluetooth or LAN. Cash drawer kick. Browser-print fallback. Receipts can be sent by WhatsApp. KRA PIN and VAT breakdown. |
| **Sales history** | Search by receipt, customer, M-Pesa code or serial number. Reprint. Full or partial refunds, with optional restock. |
| **Inventory** | Parts with SKU, barcode, OEM number, brand, bin location, fitment, cost/price/margin and reorder level. Stock count, adjustment and write-off, all logged with a per-part stock history. CSV import/export. |
| **Purchasing** | Suppliers and purchase orders. **Auto-reorder** drafts a PO for everything below its reorder level. Receive full or partial deliveries straight into stock (this also updates cost price). |
| **Service jobs** | Workshop board (booked in → being worked on → waiting for parts → ready). Records parts used and labour, then **bills at the till** in one tap. |
| **Customers** | Rider profiles (phone, bike, plate), purchase history, account balances and payments received. |
| **Shifts** | Open with a float, record cash in/out, blind cash-up with over/short, printed Z report. |
| **Reports** | Net sales, gross profit and margin, VAT collected (for KRA), takings by payment method, daily trend, top sellers, sales by category, reorder list. CSV export. |
| **Staff** | PIN login. Owner, manager and cashier roles. |
| **Data** | Stored on the till itself (IndexedDB), so it keeps selling through internet and power cuts. One-click JSON backup and restore. |

More screens: [payment](docs/screenshots/payment.png) · [receipt](docs/screenshots/receipt.png) · [inventory](docs/screenshots/inventory.png) · [reports](docs/screenshots/reports.png) · [shift](docs/screenshots/shift.png) · [service](docs/screenshots/service.png)

## Quick start

```bash
npm install
npm run build          # build the app into dist/
npm run server:start   # serves the app + M-Pesa/printer API on http://localhost:8787
```

Open `http://localhost:8787` in **Chrome or Edge**. Default PINs: owner `1234`, cashier `0000`. Change them in *Settings → Users*. The sample catalogue can be edited or deleted in *Inventory*.

To develop, run `npm run dev` (Vite on :5173) and `npm run server` (API on :8787, proxied).

```bash
npm test               # unit + database tests (vitest, fake IndexedDB)
npm run typecheck
```

### Configuration

- **Shop details, VAT, receipt footer, bike models, staff and hardware:** in the app, under *Settings*.
- **M-Pesa STK Push:** copy `.env.example` to `.env` and fill in your Daraja credentials. See [docs/MPESA.md](docs/MPESA.md).
- **Hardware:** see [docs/HARDWARE.md](docs/HARDWARE.md) for the recommended bundle and setup.

## Architecture

```
Browser (Chrome/Edge, installable PWA)        server/ (Node + Express, on the shop PC)
 ├─ React + Tailwind UI                         ├─ serves dist/
 ├─ Dexie (IndexedDB)  ← all shop data          ├─ /api/mpesa/*  Daraja STK Push + callback + query
 ├─ ESC/POS encoder  → WebUSB / Web Serial      └─ /api/print    relays ESC/POS bytes to LAN printers :9100
 └─ HID barcode-scanner listener
```

- `src/db/`: schema, sales/refund/stock transactions, shifts, purchasing, seed data
- `src/lib/`: cart maths (VAT-inclusive or exclusive, discount apportioning), ESC/POS, printer transports, M-Pesa client, CSV
- `src/pages/`: one file per screen
- `server/`: Daraja client and the printer relay

Money is stored as integer cents. Every stock change goes through a logged movement (sale, refund, receive, adjust, damage, count).

## Roadmap / not yet built

- **KRA eTIMS** electronic tax invoices (needed for VAT-registered businesses). The receipt and VAT data are already in place; the next step is an eTIMS OSCU/VSCU integration on the server.
- Multi-till / multi-branch sync (today each till keeps its own data; back up daily).
- Barcode label printing for parts that arrive without barcodes.
- Customer SMS (Africa's Talking) for "your bike is ready" and receipts.

See [docs/UX-RESEARCH.md](docs/UX-RESEARCH.md) for the retail POS patterns this design draws on.
