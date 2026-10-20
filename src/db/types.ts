// All money values are stored as integer cents (KES x 100) to avoid float drift.

export type Role = 'owner' | 'manager' | 'cashier'

export interface User {
  id?: number
  name: string
  pin: string
  role: Role
  active: boolean
  /** Optional profile details shown on the Profile page. */
  email?: string
  phone?: string
  about?: string
}

export interface Category {
  id?: number
  name: string
  color: string
}

export interface Supplier {
  id?: number
  name: string
  phone?: string
  email?: string
  notes?: string
}

export interface Product {
  id?: number
  sku: string
  barcode?: string
  name: string
  categoryId?: number
  brand?: string
  /** Manufacturer / OEM part number, used when matching a customer's old part. */
  partNumber?: string
  /** Bike models this part fits, e.g. "Ekon 450". Empty = universal. */
  fitment: string[]
  cost: number
  price: number
  stock: number
  reorderLevel: number
  supplierId?: number
  /** Shelf / bin location in the store room. */
  location?: string
  /** Optional product photo, stored as a data URL. */
  image?: string
  taxable: boolean
  /** Serial-tracked items (batteries, controllers, motors) ask for a serial at sale time. */
  serialized: boolean
  /** Labour and services don't carry stock. */
  trackStock: boolean
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface Customer {
  id?: number
  name: string
  phone?: string
  email?: string
  bikeModel?: string
  plate?: string
  /** Amount the customer owes the shop (on-account / credit sales). */
  balance: number
  creditLimit: number
  notes?: string
  createdAt: number
}

export type PaymentMethod = 'cash' | 'mpesa' | 'card' | 'account'

export interface Payment {
  method: PaymentMethod
  amount: number
  /** M-Pesa confirmation code, card approval code, etc. */
  reference?: string
}

export interface SaleLine {
  productId?: number
  /** Free-text lines (labour, misc) have no productId. */
  name: string
  sku?: string
  qty: number
  unitPrice: number
  unitCost: number
  /** Discount applied to the whole line, in cents. */
  discount: number
  taxable: boolean
  serial?: string
  refundedQty?: number
}

export type SaleStatus = 'completed' | 'refunded' | 'partially_refunded' | 'voided'

export interface Sale {
  id?: number
  receiptNo: string
  createdAt: number
  lines: SaleLine[]
  subtotal: number
  /** Cart-level discount, applied after line discounts. */
  discount: number
  tax: number
  total: number
  payments: Payment[]
  change: number
  customerId?: number
  userId: number
  shiftId?: number
  status: SaleStatus
  note?: string
  /** For refund records: the receipt being refunded. */
  refundOf?: number
}

export interface ParkedSale {
  id?: number
  label: string
  createdAt: number
  lines: SaleLine[]
  discount: number
  customerId?: number
  userId: number
}

export type MovementReason = 'sale' | 'refund' | 'receive' | 'adjust' | 'damage' | 'count'

export interface StockMovement {
  id?: number
  productId: number
  change: number
  reason: MovementReason
  reference?: string
  note?: string
  userId?: number
  at: number
}

export interface PurchaseOrderLine {
  productId: number
  qty: number
  unitCost: number
  received: number
}

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled'

export interface PurchaseOrder {
  id?: number
  poNo: string
  supplierId?: number
  lines: PurchaseOrderLine[]
  status: PurchaseOrderStatus
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface CashMovement {
  type: 'in' | 'out'
  amount: number
  reason: string
  at: number
}

export interface Shift {
  id?: number
  userId: number
  openedAt: number
  closedAt?: number
  openingFloat: number
  cashMovements: CashMovement[]
  /** Filled in when the shift is closed. */
  countedCash?: number
  expectedCash?: number
  notes?: string
}

export type JobStatus = 'open' | 'in_progress' | 'waiting_parts' | 'ready' | 'collected'

export interface ServiceJob {
  id?: number
  jobNo: string
  customerId?: number
  customerName: string
  phone?: string
  bikeModel?: string
  plate?: string
  complaint: string
  lines: SaleLine[]
  labour: number
  status: JobStatus
  mechanic?: string
  createdAt: number
  updatedAt: number
  saleId?: number
}

export interface Settings {
  shopName: string
  address: string
  phone: string
  kraPin: string
  vatRate: number
  pricesIncludeVat: boolean
  receiptFooter: string
  currency: string
  mpesaTill: string
  mpesaMode: 'manual' | 'stk'
  apiUrl: string
  bikeModels: string[]
  paperWidth: 58 | 80
  autoPrint: boolean
  openDrawerOnCash: boolean
  /** Payment methods shown in the checkout tender list. At least one must stay enabled. */
  enabledPayments: PaymentMethod[]
  /** Which alert groups the Notifications page shows. */
  notifyLowStock: boolean
  notifyOwing: boolean
  notifyJobUpdates: boolean
}

export type LogKind = 'auth' | 'sale' | 'stock' | 'shift' | 'settings' | 'user' | 'system'

export interface LogEntry {
  id?: number
  at: number
  kind: LogKind
  action: string
  detail?: string
  userId?: number
  userName?: string
}
