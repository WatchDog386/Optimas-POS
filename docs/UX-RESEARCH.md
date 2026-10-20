# Design notes: patterns borrowed from leading retail POS systems

Optimas POS does not copy any vendor's code, branding, names, logos or assets. Instead, it adopts the **workflow patterns** that well-known retail POS products have converged on. These are documented publicly in their help centres and visible in their product demos. The main references were:

- **Lightspeed Retail**: widely used by bicycle and powersports parts shops. It added work orders, serialized items and special orders.
- **Square for Retail**: tap-tile register, split tender, simple receipts.
- **Loyverse**: popular with small shops in East Africa. Offline-first, shifts with cash-up, PIN login.
- **Shopify POS / Vend (Lightspeed X)**: park/retrieve sales, stock-take, purchase orders.

## Patterns adopted

| Pattern | Where it's seen | How Optimas implements it |
|---|---|---|
| **Two-pane register**: product grid on the left, ticket/cart on the right, one large "Charge" button | All of the above | `SellPage`. The Charge button always shows the live total. |
| **Category tabs plus colour-coded tiles** | Square, Loyverse | Category chips and a coloured bar on each tile. Stock badge goes amber when low and red when out. |
| **Scan anywhere** | Lightspeed, Shopify | `useBarcodeScanner` detects HID-scanner bursts globally, so no field needs focus. |
| **Vehicle fitment lookup** | Lightspeed (bike shops), auto-parts systems | "Fits [bike model]" filter and per-part fitment list. Attaching a customer auto-selects their bike. |
| **Serialized items** | Lightspeed | Batteries, controllers and chargers prompt for a serial number. Serials print on receipts and can be searched in history (for warranty claims). |
| **Work orders → till** | Lightspeed | Service board with status columns. "Bill at till" moves the parts and labour into the cart. |
| **Park / retrieve sale** | Vend, Shopify | Park button (F8) and a parked-sales list. |
| **Split tender with tender list** | Square, Lightspeed | Payment modal lists the tenders added and shows the remaining amount. Only cash can be over-tendered (change). |
| **Quick-cash buttons** | Square, Loyverse | Exact amount plus the next round notes. |
| **Local mobile money** | Loyverse/Kenyan POS integrations | M-Pesa manual code entry or STK Push. |
| **Shift with float and blind cash-up** | Loyverse, Lightspeed | Open float, cash in/out, counted vs expected, Z report. |
| **Employee PIN lock and roles** | Loyverse, Square | 4-digit PIN screen with owner/manager/cashier permissions. |
| **Auto-reorder POs** | Lightspeed, Vend | Drafts a PO from items at or below their reorder level. Partial receiving is supported. |
| **On-account / house charge** | Lightspeed | Customer balance and credit limit. Account payments are recorded. |
| **Receipt via WhatsApp** | Common in Kenyan retail | wa.me link with a text receipt. |

## Kenyan-market specifics

- Prices are **VAT-inclusive by default (16%)**, with VAT shown separately on the receipt and a VAT-collected figure in Reports.
- The KRA PIN is printed on receipts. eTIMS integration is on the roadmap.
- Offline-first, because internet and power interruptions are common. A UPS is part of the recommended hardware.
- Amounts are in KES with en-KE formatting.
