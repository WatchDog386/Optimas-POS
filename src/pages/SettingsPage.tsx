import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RefreshCw, AlertTriangle, Banknote, Bell, Bike, CreditCard, Database, Download, Info, Loader2, PackageSearch, Percent, Printer, Save, ShieldCheck, Smartphone, Store, Trash2, UserRound } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, PRE_PRODUCTION_ARCHIVE, queueAllForUpload } from '../db/db'
import { logActivity } from '../db/logs'
import { hashPin, isPinHash, verifyPin } from '../lib/pinHash'
import { api, pushUsers, reconnectServer, registerWithServer, serverLink, type ServerLink } from '../lib/api'
import { redownloadAll, syncNow, useSyncStatus } from '../lib/sync'
import { ago, syncLabel } from '../components/SyncStatus'
import { currentTill } from '../db/till'
import { lookupCode } from '../db/units'
import { saveSettings, useSettings } from '../db/settings'
import type { PaymentMethod, Settings, User } from '../db/types'
import { agentPrinters, agentStatus, guessPrinter, loadPrinterConfig, loadBarcodePrinterConfig, pairPrinter, savePrinterConfig, saveBarcodePrinterConfig, sendRaw, supports, type PrinterConfig, type PrinterSlot } from '../lib/printer'
import { printLabelsInBrowser, priceText, tsplBytes, tsplCalibrateBytes, type LabelJob } from '../lib/labels'
import { code128Svg } from '../lib/barcode'
import { agentInstallerCmd } from '../lib/agentInstaller'
import { drawerKickBytes, escposLabelBytes, testPageBytes } from '../lib/escpos'
import { download } from '../lib/csv'
import { money, toCents } from '../lib/money'
import { useSession } from '../session'
import { PageHeader, errorText, useToast } from '../components/ui'
import ChangePinForm from '../components/ChangePinForm'

const TABS = ['Shop & receipt', 'Taxes', 'Payments', 'Hardware', 'Bike models', 'Notifications', 'Security', 'Sync', 'Backup', 'About'] as const
type Tab = (typeof TABS)[number]

const APP_VERSION = '1.0.0'

const SECTIONS: { group: string; items: { id: Tab; icon: typeof Store; tint: string; desc: string }[] }[] = [
  {
    group: 'Store',
    items: [
      { id: 'Shop & receipt', icon: Store, tint: 'bg-sky-100 text-sky-600', desc: 'Identity printed on every receipt, plus your returns policy line.' },
      { id: 'Taxes', icon: Percent, tint: 'bg-blue-100 text-blue-600', desc: 'VAT rate and whether shelf prices include tax.' },
      { id: 'Payments', icon: Banknote, tint: 'bg-violet-100 text-violet-600', desc: 'Currency, accepted tenders, M-Pesa and the local server.' },
      { id: 'Hardware', icon: Printer, tint: 'bg-slate-200 text-slate-600', desc: 'Receipt printers, cash drawer and barcode scanners.' },
      { id: 'Bike models', icon: Bike, tint: 'bg-amber-100 text-amber-600', desc: 'Models used for part fitment and the Fits filter.' },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'Notifications', icon: Bell, tint: 'bg-rose-100 text-rose-600', desc: 'Choose which alert groups appear on the Notifications page.' },
      { id: 'Security', icon: ShieldCheck, tint: 'bg-indigo-100 text-indigo-600', desc: 'Your PIN and how this till locks.' },
      { id: 'Sync', icon: RefreshCw, tint: 'bg-emerald-100 text-emerald-700', desc: 'Keep every till and the shop server in step.' },
      { id: 'Backup', icon: Download, tint: 'bg-teal-100 text-teal-600', desc: 'Download, restore and protect your data.' },
      { id: 'About', icon: Info, tint: 'bg-cyan-100 text-cyan-700', desc: 'Version, storage usage and factory reset.' },
    ],
  },
]

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items)
const DESCS = Object.fromEntries(ALL_ITEMS.map((i) => [i.id, i.desc])) as Record<Tab, string>

export default function SettingsPage() {
  const [params] = useSearchParams()
  const asked = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(asked && (TABS as readonly string[]).includes(asked) ? asked : 'Shop & receipt')
  useEffect(() => {
    if (asked && (TABS as readonly string[]).includes(asked)) setTab(asked)
  }, [asked])
  const active = ALL_ITEMS.find((i) => i.id === tab)!

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Settings"
        subtitle="Everything the till remembers — shop profile, money, hardware and data"
        actions={
          <Link to="/staff" className="btn-ghost">
            Manage staff
          </Link>
        }
      />

      <div className="grid max-w-6xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:grid-cols-[270px_1fr]">
        {/* Left section nav */}
        <nav className="border-b border-slate-100 bg-slate-50/70 p-3 md:border-b-0 md:border-r">
          {SECTIONS.map((group) => (
            <div key={group.group} className="mb-4 last:mb-1">
              <div className="mb-1.5 px-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{group.group}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const on = tab === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-semibold transition ${
                        on ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${on ? 'bg-white/20 text-white' : item.tint}`}
                      >
                        <Icon size={15} />
                      </span>
                      <span className="truncate">{item.id}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Right content pane */}
        <div className="min-w-0 p-6 lg:p-8">
          <div className="mb-5 flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${active.tint}`}>
              <active.icon size={19} />
            </span>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-slate-900 sm:text-xl">{tab}</h2>
              <p className="text-sm text-slate-500">{DESCS[tab]}</p>
            </div>
          </div>

          {tab === 'Shop & receipt' && <ShopSettings />}
          {tab === 'Taxes' && <TaxSettings />}
          {tab === 'Payments' && <PaymentsSettings />}
          {tab === 'Hardware' && <HardwareSettings />}
          {tab === 'Bike models' && <BikeSettings />}
          {tab === 'Notifications' && <NotifySettings />}
          {tab === 'Security' && <SecuritySettings />}
          {tab === 'Sync' && <SyncSettings />}
          {tab === 'Backup' && <BackupSettings />}
          {tab === 'About' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function useDraft() {
  const settings = useSettings()
  const [draft, setDraft] = useState<Settings>(settings)
  useEffect(() => setDraft(settings), [settings])
  const toast = useToast()
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const save = async () => {
    await saveSettings(draft)
    toast('Settings saved')
  }
  return { draft, set, save }
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function SaveBar({ onSave, label }: { onSave: () => void; label?: string }) {
  return (
    <div className="mt-5 flex justify-end">
      <button className="btn-primary" onClick={onSave}>
        <Save size={16} /> {label ?? 'Save'}
      </button>
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 border-t border-slate-100 pt-5 first:border-0 first:pt-0">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">{title}</h3>
      {desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** VAT split for a worked example / receipt preview. */
function taxSplit(amount: number, rate: number, incl: boolean) {
  const vat = incl ? Math.round((amount * rate) / (100 + rate)) : Math.round((amount * rate) / 100)
  return incl ? { net: amount - vat, vat, total: amount } : { net: amount, vat, total: amount + vat }
}

// ---------------------------------------------------------------- Shop & receipt

function ShopSettings() {
  const { draft, set, save } = useDraft()
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Shop name">
          <input className="input" value={draft.shopName} onChange={(e) => set('shopName', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Address">
          <input className="input" value={draft.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="KRA PIN" hint="Printed on receipts.">
          <input className="input uppercase" value={draft.kraPin} onChange={(e) => set('kraPin', e.target.value.toUpperCase())} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Receipt footer" hint="Thank-you line, returns policy, warranty wording…">
            <textarea className="input" rows={2} value={draft.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">Receipt preview</h3>
          <ReceiptPreview s={draft} />
        </div>
        <div className="text-sm leading-relaxed text-slate-600">
          <p>
            This header and footer print at the top and bottom of every receipt. VAT lines use the rates from the{' '}
            <b>Taxes</b> tab and the logo/paper size live under <b>Hardware</b>.
          </p>
          <p className="mt-2 text-xs text-slate-500">Preview shows an 80&nbsp;mm layout with a sample line.</p>
        </div>
      </div>
      <SaveBar onSave={save} />
    </>
  )
}

function ReceiptPreview({ s }: { s: Settings }) {
  const ex = taxSplit(125000, s.vatRate, s.pricesIncludeVat)
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 shadow-sm">
      <div className="mx-auto max-w-[260px] font-mono text-[11px] leading-relaxed text-slate-700">
        <div className="text-center">
          <div className="text-sm font-bold uppercase tracking-wide">{s.shopName || 'Shop name'}</div>
          <div>{s.address}</div>
          {s.phone && <div>{s.phone}</div>}
          {s.kraPin && <div>PIN {s.kraPin}</div>}
        </div>
        <div className="my-2 border-t border-dashed border-slate-300" />
        <div className="flex justify-between">
          <span>1 × Sample part</span>
          <span>{money(ex.net, '')}</span>
        </div>
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{money(ex.net, '')}</span>
        </div>
        {s.vatRate > 0 && (
          <div className="flex justify-between">
            <span>VAT {s.vatRate}%</span>
            <span>{money(ex.vat, '')}</span>
          </div>
        )}
        <div className="flex justify-between font-bold">
          <span>TOTAL {s.currency}</span>
          <span>{money(ex.total, '')}</span>
        </div>
        <div className="my-2 border-t border-dashed border-slate-300" />
        <div className="text-center">{s.receiptFooter}</div>
        <div className="mt-2 text-center text-[9px] uppercase tracking-widest text-slate-400">{s.paperWidth} mm preview</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Taxes

function TaxSettings() {
  const { draft, set, save } = useDraft()
  const [sample, setSample] = useState('1000')
  const cents = toCents(sample)
  const ex = taxSplit(cents, draft.vatRate, draft.pricesIncludeVat)

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="VAT rate %" hint="Kenya standard rate is 16. Set 0 if you are not registered.">
          <input className="input" type="number" min={0} max={100} value={draft.vatRate} onChange={(e) => set('vatRate', Number(e.target.value))} />
        </Field>
        <Field label="Shelf prices">
          <select className="input" value={draft.pricesIncludeVat ? 'incl' : 'excl'} onChange={(e) => set('pricesIncludeVat', e.target.value === 'incl')}>
            <option value="incl">Include VAT in shelf prices</option>
            <option value="excl">Add VAT at checkout</option>
          </select>
        </Field>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wide text-slate-600">Worked example</h4>
            <p className="text-xs text-slate-500">
              {draft.pricesIncludeVat ? 'Customer pays the shelf price; VAT is inside it.' : 'VAT is added on top at the till.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-500">{draft.currency}</span>
            <input className="input w-28 text-right" inputMode="decimal" value={sample} onChange={(e) => setSample(e.target.value)} />
          </div>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">Net (before VAT)</dt>
            <dd className="font-bold text-slate-800">{money(ex.net, draft.currency)}</dd>
          </div>
          <div className="rounded-lg bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">VAT at {draft.vatRate}%</dt>
            <dd className="font-bold text-slate-800">{money(ex.vat, draft.currency)}</dd>
          </div>
          <div className="rounded-lg bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">Customer pays</dt>
            <dd className="font-bold text-brand-700">{money(ex.total, draft.currency)}</dd>
          </div>
        </dl>
      </div>
      <SaveBar onSave={save} />
    </>
  )
}

// ---------------------------------------------------------------- Payments (currency + methods + M-Pesa + API)

const CURRENCIES = ['KES', 'UGX', 'TZS', 'RWF', 'BIF', 'USD', 'EUR', 'GBP', 'GHS', 'NGN', 'ZAR', 'INR']

const METHOD_META: { id: PaymentMethod; label: string; desc: string; icon: typeof Banknote }[] = [
  { id: 'cash', label: 'Cash', desc: 'Notes and coins at the counter', icon: Banknote },
  { id: 'mpesa', label: 'M-Pesa', desc: 'Confirmation code or STK push', icon: Smartphone },
  { id: 'card', label: 'Card', desc: 'Debit / credit card terminal', icon: CreditCard },
  { id: 'account', label: 'On account', desc: "Post to a customer's credit balance", icon: UserRound },
]

function PaymentsSettings() {
  const { draft, set, save } = useDraft()
  const toast = useToast()
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const toggle = (id: PaymentMethod) => {
    const on = draft.enabledPayments.includes(id)
    set('enabledPayments', on ? draft.enabledPayments.filter((m) => m !== id) : [...draft.enabledPayments, id])
  }

  const testApi = async () => {
    setTesting(true)
    setStatus(null)
    try {
      const base = draft.apiUrl.replace(/\/$/, '')
      const r = await fetch(`${base}/health`, { headers: { Accept: 'application/json' } })
      if (!r.ok) throw new Error(`Server replied HTTP ${r.status}`)
      const j = (await r.json()) as { ok?: boolean; mpesa?: string }
      setStatus({ ok: !!j.ok, msg: `Connected${j.mpesa ? ` · M-Pesa ${j.mpesa}` : ''}` })
    } catch (e) {
      setStatus({ ok: false, msg: `Not reachable — ${errorText(e)}` })
    } finally {
      setTesting(false)
    }
  }

  const saveAll = async () => {
    if (draft.enabledPayments.length === 0) return toast('Keep at least one payment method enabled', 'error')
    await save()
  }

  return (
    <>
      <Section title="Currency" desc="Shown on every price, receipt and report.">
        <div className="grid items-end gap-4 md:grid-cols-2">
          <div className="flex items-end gap-3">
            <div className="w-32">
              <input
                className="input uppercase"
                list="currency-codes"
                maxLength={3}
                value={draft.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
                aria-label="Currency code"
              />
              <datalist id="currency-codes">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
              Preview: <b className="text-slate-900">{money(1234567, draft.currency)}</b>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Accepted at checkout" desc="Enabled methods appear on the tender row. Disable anything you never take.">
        <div className="grid gap-3 sm:grid-cols-2">
          {METHOD_META.map(({ id, label, desc, icon: Icon }) => {
            const on = draft.enabledPayments.includes(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${on ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <span className={`mt-0.5 rounded-lg p-2 ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-semibold text-slate-900">
                    {label}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {on ? 'On' : 'Off'}
                    </span>
                  </span>
                  <span className="block text-sm text-slate-500">{desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="M-Pesa" desc="Till number printed on receipts, plus how cashiers capture payments.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Till / Paybill number">
            <input className="input" value={draft.mpesaTill} onChange={(e) => set('mpesaTill', e.target.value)} />
          </Field>
          <Field label="Mode">
            <select className="input" value={draft.mpesaMode} onChange={(e) => set('mpesaMode', e.target.value as Settings['mpesaMode'])}>
              <option value="manual">Manual — cashier types the confirmation code</option>
              <option value="stk">STK Push — prompt sent to the customer's phone</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Local server" desc="Handles M-Pesa STK Push (Daraja) and network printers. Default /api works when the app is served by that server.">
        <div className="flex gap-2">
          <input className="input font-mono" value={draft.apiUrl} onChange={(e) => set('apiUrl', e.target.value)} />
          <button className="btn-ghost shrink-0" onClick={testApi} disabled={testing}>
            {testing ? <Loader2 size={16} className="animate-spin" /> : null} Test connection
          </button>
        </div>
        {status && (
          <p className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${status.ok ? 'text-emerald-600' : 'text-red-600'}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${status.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {status.msg}
          </p>
        )}
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          STK Push needs Safaricom Daraja credentials in the server's <code>.env</code> file. See <code>docs/MPESA.md</code>. Manual mode works with no setup and no internet.
        </p>
      </Section>

      <SaveBar onSave={saveAll} />
    </>
  )
}

// ---------------------------------------------------------------- Hardware

const MODES = [
  ['agent', 'Windows printer'],
  ['browser', 'Browser print'],
  ['usb', 'USB (WebUSB)'],
  ['serial', 'Serial / Bluetooth'],
  ['network', 'Network (LAN)'],
] as const

const LABEL_PRESETS: { label: string; w: number; h: number; gap: number }[] = [
  { label: '40 × 30 mm', w: 40, h: 30, gap: 2 },
  { label: '50 × 30 mm', w: 50, h: 30, gap: 2 },
  { label: '50 × 25 mm', w: 50, h: 25, gap: 2 },
  { label: '38 × 25 mm', w: 38, h: 25, gap: 2 },
  { label: '30 × 20 mm', w: 30, h: 20, gap: 2 },
  { label: '60 × 40 mm', w: 60, h: 40, gap: 3 },
]

/** Connection picker shared by the receipt and label printer cards. */
function PrinterConnection({
  slot,
  cfg,
  onChange,
  onPaired,
  run,
}: {
  slot: PrinterSlot
  cfg: PrinterConfig
  onChange: (c: PrinterConfig) => void
  onPaired: (c: PrinterConfig) => void
  run: (fn: () => Promise<void>, ok: string) => Promise<void>
}) {
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        {MODES.map(([m, label]) => (
          <button key={m} className={cfg.mode === m ? 'btn-dark' : 'btn-ghost'} onClick={() => onChange({ ...cfg, mode: m, device: undefined, deviceName: undefined })}>
            {label}
          </button>
        ))}
      </div>
      {(cfg.mode === 'usb' || cfg.mode === 'serial') && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={() => run(async () => onPaired(await pairPrinter(slot, cfg)), 'Printer paired')}>
              {cfg.deviceName ? 'Re-pair printer' : 'Pair printer'}
            </button>
            {cfg.deviceName ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {cfg.deviceName}
              </span>
            ) : (
              <span className="text-xs font-semibold text-amber-700">Not paired yet</span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {cfg.mode === 'usb'
              ? supports.usb()
                ? 'Chrome/Edge. On Windows, install the WinUSB driver for the printer once with Zadig, then pair.'
                : 'WebUSB is not supported in this browser — use Chrome or Edge.'
              : supports.serial()
                ? 'For USB-serial and paired Bluetooth printers.'
                : 'Web Serial is not supported in this browser — use Chrome or Edge.'}
          </p>
          {cfg.mode === 'serial' && (
            <div className="w-48">
              <Field label="Baud rate">
                <select className="input" value={cfg.baudRate ?? 9600} onChange={(e) => onChange({ ...cfg, baudRate: Number(e.target.value) })}>
                  {[9600, 19200, 38400, 57600, 115200].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>
      )}
      {cfg.mode === 'agent' && <AgentPicker slot={slot} cfg={cfg} onChange={onChange} />}
      {cfg.mode === 'network' && !shopNetworkServer() && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <b>This won't reach your printer.</b> Network printing is relayed by the shop server, and this till uses an online server ({window.location.hostname}) that
          can't see printers on the shop's network. Use <b>Windows printer</b> instead.
        </p>
      )}
      {cfg.mode === 'network' && (
        <div className="mb-3 grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Printer IP address" hint="Print the printer's self-test page to find it (hold FEED while switching on).">
              <input className="input font-mono" placeholder="192.168.1.50" value={cfg.host ?? ''} onChange={(e) => onChange({ ...cfg, host: e.target.value.trim() })} />
            </Field>
          </div>
          <Field label="Port">
            <input className="input" type="number" min={9100} max={9109} value={cfg.port ?? 9100} onChange={(e) => onChange({ ...cfg, port: Number(e.target.value) })} />
          </Field>
        </div>
      )}
    </>
  )
}

/** Agent status + Windows printer dropdown for one slot. */
function AgentPicker({ slot, cfg, onChange }: { slot: PrinterSlot; cfg: PrinterConfig; onChange: (c: PrinterConfig) => void }) {
  const [version, setVersion] = useState<string | null | undefined>(undefined)
  const [printers, setPrinters] = useState<string[]>([])
  const [error, setError] = useState('')

  const check = async () => {
    setError('')
    const v = await agentStatus()
    setVersion(v)
    if (!v) return setPrinters([])
    try {
      const names = await agentPrinters()
      setPrinters(names)
      // First time: pick the XP-330B for labels / XP-80C for receipts automatically.
      if (!cfg.printerName || !names.includes(cfg.printerName)) {
        const guess = guessPrinter(names, slot)
        if (guess) onChange({ ...cfg, printerName: guess })
      }
    } catch (e) {
      setError(errorText(e))
    }
  }
  useEffect(() => {
    void check()
    // Run once when the panel opens.
  }, [])

  const installer = () => download('Install Optimas Print Agent.cmd', agentInstallerCmd(window.location.origin), 'application/octet-stream')
  const want = slot === 'label' ? 'XP-330B' : 'XP-80C'

  return (
    <div className="mb-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {version === undefined ? (
          <span className="text-slate-500">Checking the print agent…</span>
        ) : version ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Print agent running (v{version})
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Print agent not found on this computer
          </span>
        )}
        <button type="button" className="text-xs font-semibold text-brand-600" onClick={() => void check()}>
          Check
        </button>
      </div>

      {version ? (
        <Field label={`Windows printer for ${slot === 'label' ? 'barcode labels' : 'receipts'}`} hint={`Pick the ${want}. Jobs go straight to it — no print dialog.`}>
          <select className="input" value={cfg.printerName ?? ''} onChange={(e) => onChange({ ...cfg, printerName: e.target.value || undefined })}>
            <option value="">Choose a printer…</option>
            {printers.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div className="space-y-2 text-slate-600">
          <p>
            The print agent is a small helper for this Windows computer. It sends receipts to the <b>XP-80C</b> and labels to the <b>XP-330B</b> by name, using their normal
            Windows drivers — no print dialog, no driver changes. Install it once:
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Install both printers in Windows with the Xprinter drivers (they appear under Settings → Printers).</li>
            <li>
              <button type="button" className="font-semibold text-brand-600 underline" onClick={installer}>
                Download the installer
              </button>{' '}
              and double-click it. (If Windows warns about the file, choose More info → Run anyway.)
            </li>
            <li>Come back here and press Check. If Chrome asks to allow access to devices on your local network, choose Allow.</li>
          </ol>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {version && slot === 'label' && cfg.printerName && guessPrinter([cfg.printerName], 'receipt') && !/330/.test(cfg.printerName) && (
        <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">“{cfg.printerName}” looks like the receipt printer. Labels should go to the XP-330B.</p>
      )}
    </div>
  )
}

/** True when the app is served from the shop's own network (a server that can reach LAN printers). */
function shopNetworkServer(): boolean {
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)
}

const RECEIPT_MODELS = [
  { id: 'xp-80c', label: 'Xprinter XP-80C — 80 mm', paper: 80 as const },
  { id: 'xp-58', label: 'Xprinter XP-58 — 58 mm', paper: 58 as const },
  { id: 'other-80', label: 'Other ESC/POS printer — 80 mm', paper: 80 as const },
  { id: 'other-58', label: 'Other ESC/POS printer — 58 mm', paper: 58 as const },
]

const LABEL_MODELS = [
  { id: 'xp-330b', label: 'Xprinter XP-330B', lang: 'tspl' as const },
  { id: 'xp-365b', label: 'Xprinter XP-365B / XP-420B / XP-460B', lang: 'tspl' as const },
  { id: 'other-tspl', label: 'Other TSPL label printer (TSC, Gprinter…)', lang: 'tspl' as const },
  { id: 'escpos', label: 'Receipt-type printer printing on a roll (ESC/POS)', lang: 'escpos' as const },
]

/** Step-by-step connection guide shown under each printer. */
function ConnectGuide({ model }: { model: 'XP-80C' | 'XP-330B' }) {
  return (
    <details className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
      <summary className="cursor-pointer font-semibold text-slate-800">How to connect the {model} (USB, Chrome or Edge)</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {model === 'XP-330B' && <li>Load the 40 × 30 mm label roll. Switch on while holding <b>FEED</b> until it beeps — it measures the labels.</li>}
        <li>Plug the {model} into the till by USB and switch it on.</li>
        <li>
          On Windows, give it the WinUSB driver once: run <b>Zadig</b>, choose <b>Options → List all devices</b>, select the {model}, choose <b>WinUSB</b>, press{' '}
          <b>Replace driver</b>. (Not needed on Linux, ChromeOS or Android.)
        </li>
        <li>
          Choose <b>USB (WebUSB)</b> above, press <b>Pair printer</b> and pick the {model} in the list — not the other printer.
        </li>
        <li>Press {model === 'XP-330B' ? <b>Print test label</b> : <b>Print test page</b>}. It should come out of the {model} only.</li>
      </ol>
    </details>
  )
}

function HardwareSettings() {
  const { draft, set, save } = useDraft()
  const toast = useToast()
  const [cfg, setCfg] = useState<PrinterConfig>(loadPrinterConfig)
  const [bcCfg, setBcCfg] = useState<PrinterConfig>(loadBarcodePrinterConfig)

  const update = (c: PrinterConfig) => {
    setCfg(c)
    savePrinterConfig(c)
  }
  const updateBc = (c: PrinterConfig) => {
    setBcCfg(c)
    saveBarcodePrinterConfig(c)
  }
  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn()
      toast(ok)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const sample: LabelJob = { name: 'LABEL PRINTER TEST', sku: 'TEST-001', code: '2100000000014', price: 85000 }
  const testLabel = () =>
    run(async () => {
      // Print with the values on screen, so the test reflects unsaved changes.
      const outcome = await printLabelsWith([sample], draft, bcCfg)
      if (outcome === 'blocked') throw new Error('Allow popups for this site to print in the browser')
    }, 'Test label sent')

  const presetKey = `${draft.labelWidthMm}x${draft.labelHeightMm}`

  return (
    <>
      <Section title="Receipt printer — receipts only" desc="Prints customer receipts, Z-reports and opens the cash drawer. Barcode labels never go to this printer.">
        <div className="mb-3 max-w-md">
          <Field label="Printer model">
            <select
              className="input"
              value={cfg.model ?? ''}
              onChange={(e) => {
                const m = RECEIPT_MODELS.find((x) => x.id === e.target.value)
                update({ ...cfg, model: e.target.value || undefined })
                if (m) set('paperWidth', m.paper)
              }}
            >
              <option value="">Choose your receipt printer…</option>
              {RECEIPT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <PrinterConnection slot="receipt" cfg={cfg} onChange={update} onPaired={update} run={run} />
        {cfg.mode === 'browser' && (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Browser print uses the system print dialog: choose the <b>XP-80C</b> there each time — Chrome remembers the last printer used, which may be the label printer.
            It also cannot open the cash drawer. Choose <b>Windows printer</b> to send receipts straight to the XP-80C.
          </p>
        )}
        {cfg.mode === 'usb' && <ConnectGuide model="XP-80C" />}
        <div className="mb-4 flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={cfg.mode === 'browser'} onClick={() => run(() => sendRaw(testPageBytes(draft), cfg, draft.apiUrl, 'receipt'), 'Test page sent')}>
            Print test page
          </button>
          <button className="btn-ghost" disabled={cfg.mode === 'browser'} onClick={() => run(() => sendRaw(drawerKickBytes(), cfg, draft.apiUrl, 'receipt'), 'Drawer kick sent')}>
            Test cash drawer
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Paper width">
            <select className="input" value={draft.paperWidth} onChange={(e) => set('paperWidth', Number(e.target.value) as 58 | 80)}>
              <option value={80}>80 mm (48 columns)</option>
              <option value={58}>58 mm (32 columns)</option>
            </select>
          </Field>
          <div className="space-y-2 pt-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.autoPrint} onChange={(e) => set('autoPrint', e.target.checked)} /> Print receipt automatically after every sale
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.openDrawerOnCash} onChange={(e) => set('openDrawerOnCash', e.target.checked)} /> Open cash drawer on cash sales
            </label>
          </div>
        </div>
      </Section>

      <Section title="Barcode label printer — labels only" desc="Prints one serial barcode label per unit when stock is added. Receipts never go to this printer. The scanner reads these labels at the till.">
        <div className="mb-3 max-w-md">
          <Field label="Printer model">
            <select
              className="input"
              value={bcCfg.model ?? ''}
              onChange={(e) => {
                const m = LABEL_MODELS.find((x) => x.id === e.target.value)
                updateBc({ ...bcCfg, model: e.target.value || undefined })
                if (m) {
                  set('labelLanguage', m.lang)
                  if (m.lang === 'tspl' && !LABEL_PRESETS.some((p) => `${p.w}x${p.h}` === presetKey)) {
                    set('labelWidthMm', 40)
                    set('labelHeightMm', 30)
                    set('labelGapMm', 2)
                  }
                }
              }}
            >
              <option value="">Choose your label printer…</option>
              {LABEL_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <PrinterConnection slot="label" cfg={bcCfg} onChange={updateBc} onPaired={updateBc} run={run} />
        {bcCfg.mode === 'browser' && (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Browser print opens the system print dialog: choose the <b>XP-330B</b> there and set its paper size to the label size — Chrome remembers the last printer used,
            which may be the receipt printer. Choose <b>Windows printer</b> to send labels straight to the XP-330B.
          </p>
        )}
        {bcCfg.mode === 'usb' && <ConnectGuide model="XP-330B" />}

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Printer language" hint="Label printers (gap-sensing rolls) use TSPL.">
            <select className="input" value={draft.labelLanguage} onChange={(e) => set('labelLanguage', e.target.value as Settings['labelLanguage'])}>
              <option value="tspl">TSPL — Xprinter label printer</option>
              <option value="escpos">ESC/POS — receipt-type printer</option>
            </select>
          </Field>
          <Field label="Label size">
            <select
              className="input"
              value={LABEL_PRESETS.some((p) => `${p.w}x${p.h}` === presetKey) ? presetKey : 'custom'}
              onChange={(e) => {
                const p = LABEL_PRESETS.find((x) => `${x.w}x${x.h}` === e.target.value)
                if (p) {
                  set('labelWidthMm', p.w)
                  set('labelHeightMm', p.h)
                  set('labelGapMm', p.gap)
                }
              }}
            >
              {LABEL_PRESETS.map((p) => (
                <option key={p.label} value={`${p.w}x${p.h}`}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </Field>
          <Field label="Print darkness" hint="Raise if bars look faint; lower if they bleed.">
            <input className="w-full accent-cta" type="range" min={1} max={15} value={draft.labelDensity} onChange={(e) => set('labelDensity', Number(e.target.value))} />
            <div className="text-xs font-semibold text-slate-600">{draft.labelDensity} / 15</div>
          </Field>
          <Field label="Width (mm)">
            <input className="input" type="number" min={20} max={110} value={draft.labelWidthMm} onChange={(e) => set('labelWidthMm', clampNum(e.target.value, 20, 110))} />
          </Field>
          <Field label="Height (mm)">
            <input className="input" type="number" min={15} max={150} value={draft.labelHeightMm} onChange={(e) => set('labelHeightMm', clampNum(e.target.value, 15, 150))} />
          </Field>
          <Field label="Gap between labels (mm)">
            <input className="input" type="number" min={0} max={10} step={0.5} value={draft.labelGapMm} onChange={(e) => set('labelGapMm', clampNum(e.target.value, 0, 10))} />
          </Field>
        </div>

        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.autoPrintLabels} onChange={(e) => set('autoPrintLabels', e.target.checked)} /> Print labels automatically when stock is added
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.labelShowPrice} onChange={(e) => set('labelShowPrice', e.target.checked)} /> Show selling price
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.labelShowShopName} onChange={(e) => set('labelShowShopName', e.target.checked)} /> Show shop name
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[auto_1fr]">
          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Preview</div>
            <LabelPreview job={sample} s={draft} />
          </div>
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              The XP-330B speaks <b>TSPL</b>. Match the label size to the roll you loaded, press <b>Print test label</b>, then scan the printed barcode at the till — it should
              read <b>2100000000014</b>. If labels drift or skip, press <b>Calibrate gap sensor</b>.
            </p>
            <p className="text-xs text-slate-500">Serials are in-store EAN-13 numbers (prefix 21) printed as Code 128 — every USB/Bluetooth scanner reads them out of the box.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-primary" onClick={testLabel}>
                <Printer size={16} /> Print test label
              </button>
              <button
                className="btn-ghost"
                disabled={bcCfg.mode === 'browser' || draft.labelLanguage !== 'tspl'}
                onClick={() => run(() => sendRaw(tsplCalibrateBytes(draft), bcCfg, draft.apiUrl, 'label'), 'Calibration sent — the printer feeds to the next gap')}
              >
                Calibrate gap sensor
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Barcode scanner" desc="Any USB or Bluetooth scanner in keyboard (HID) mode works with no setup.">
        <p className="text-sm text-slate-600">
          Set the scanner to send <b>Enter</b> after each scan. Scanning a unit's serial label at the till adds that exact item to the sale and marks the label sold, so a copied
          or reused label is caught.
        </p>
        <ScannerTest />
      </Section>

      <SaveBar onSave={save} />
    </>
  )
}

/** Scan a printed label here to check printer → scanner → till end to end. */
function ScannerTest() {
  const [result, setResult] = useState<{ code: string; ok: boolean; text: string } | null>(null)
  const check = async (code: string) => {
    const c = code.trim()
    if (!c) return
    if (c === '2100000000014') return setResult({ code: c, ok: true, text: 'Test label read correctly — the scanner and label printer are working.' })
    const products = await db.products.filter((p) => p.active).toArray()
    const m = await lookupCode(c, products)
    setResult('product' in m ? { code: c, ok: true, text: m.serial ? `${m.product.name} — serial label, ready to sell` : `${m.product.name} — product barcode` } : { code: c, ok: false, text: m.error })
  }
  return (
    <div className="mt-3 max-w-xl">
      <label className="label">Scanner test — click here and scan a label</label>
      <input
        className="input font-mono"
        data-scan="allow"
        placeholder="Waiting for a scan…"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          void check(e.currentTarget.value)
          e.currentTarget.value = ''
        }}
      />
      {result && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          <span className="font-mono font-semibold">{result.code}</span> — {result.text}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">Nothing appears? Set the scanner to keyboard (HID) mode with an Enter suffix — see its setup barcodes in the manual.</p>
    </div>
  )
}

function clampNum(v: string, min: number, max: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

/** Print labels with explicit (possibly unsaved) settings and printer config. */
async function printLabelsWith(jobs: LabelJob[], s: Settings, cfg: PrinterConfig): Promise<'printed' | 'browser' | 'blocked'> {
  if (cfg.mode === 'browser') return printLabelsInBrowser(jobs, s) ? 'browser' : 'blocked'
  const bytes = s.labelLanguage === 'escpos' ? escposLabelBytes(jobs, s) : tsplBytes(jobs, s)
  await sendRaw(bytes, cfg, s.apiUrl, 'label')
  return 'printed'
}

/** On-screen label at true proportions, using the same SVG barcode as browser printing. */
function LabelPreview({ job, s }: { job: LabelJob; s: Settings }) {
  const scale = 4 // px per mm
  return (
    <div
      className="flex flex-col items-center justify-between overflow-hidden rounded-md border border-slate-300 bg-white px-2 py-1.5 text-center text-black shadow-sm"
      style={{ width: s.labelWidthMm * scale, height: s.labelHeightMm * scale }}
    >
      {s.labelShowShopName && <div className="text-[8px] font-bold uppercase tracking-wide">{s.shopName}</div>}
      <div className="line-clamp-2 text-[10px] font-bold leading-tight">{job.name}</div>
      {s.labelShowPrice && job.price ? <div className="text-[11px] font-extrabold">{priceText(job.price, s.currency)}</div> : null}
      <div className="min-h-0 w-full flex-1 py-0.5 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: code128Svg(job.code, { height: 60, moduleWidth: 2 }) }} />
      <div className="font-mono text-[9px] font-bold tracking-wider">{job.code}</div>
      <div className="text-[7px]">SKU {job.sku}</div>
    </div>
  )
}

// ---------------------------------------------------------------- Bike models

function BikeSettings() {
  const { draft, set, save } = useDraft()
  const [name, setName] = useState('')
  return (
    <>
      <p className="mb-3 text-sm text-slate-600">Bike models drive the “Fits” filter on the Sell screen and part fitment. Add every model your customers ride.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {draft.bikeModels.map((m) => (
          <span key={m} className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm">
            {m}
            <button className="rounded-full p-1 text-slate-400 hover:text-red-600" onClick={() => set('bikeModels', draft.bikeModels.filter((x) => x !== m))} aria-label={`Remove ${m}`}>
              <Trash2 size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ekon 450 M2" />
        <button
          className="btn-dark"
          onClick={() => {
            if (name.trim() && !draft.bikeModels.includes(name.trim())) set('bikeModels', [...draft.bikeModels, name.trim()])
            setName('')
          }}
        >
          Add
        </button>
      </div>
      <SaveBar onSave={save} />
    </>
  )
}

// ---------------------------------------------------------------- Notifications

function NotifySettings() {
  const { draft, set, save } = useDraft()
  const rows: { key: 'notifyLowStock' | 'notifyOwing' | 'notifyJobUpdates'; title: string; desc: string; icon: typeof Bell }[] = [
    { key: 'notifyLowStock', title: 'Low stock & reorders', desc: 'Parts at or below their reorder level, plus out-of-stock alerts.', icon: PackageSearch },
    { key: 'notifyOwing', title: 'Customer credit', desc: 'Customers with an outstanding on-account balance.', icon: UserRound },
    { key: 'notifyJobUpdates', title: 'Service jobs', desc: 'Jobs waiting for parts and jobs ready for collection.', icon: Bell },
  ]
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">Choose which alert groups appear on the Notifications page. The open/closed shift reminder is always shown.</p>
      <div className="space-y-3">
        {rows.map(({ key, title, desc, icon: Icon }) => (
          <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-slate-300">
            <span className={`mt-0.5 rounded-lg p-2 ${draft[key] ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              <Icon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-900">{title}</span>
              <span className="block text-sm text-slate-500">{desc}</span>
            </span>
            <span className="relative mt-1 inline-flex shrink-0">
              <input type="checkbox" className="peer sr-only" checked={draft[key]} onChange={(e) => set(key, e.target.checked)} />
              <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand-600" />
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </span>
          </label>
        ))}
      </div>
      <SaveBar onSave={save} />
    </>
  )
}

// ---------------------------------------------------------------- Security

function SecuritySettings() {
  const { user } = useSession()
  const { draft, set, save } = useDraft()

  if (!user) return null

  return (
    <>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-brand-600" />
        <div className="text-sm text-slate-600">
          You are signed in as <b className="text-slate-900">{user.name}</b> ({user.role}). Lock the till when you step away — every sale, refund and settings change is recorded against your name in the activity log.
        </div>
      </div>

      <Section title="Auto-lock" desc="Locks the till after this long without a tap, click or key press.">
        <div className="flex flex-wrap items-end gap-3">
          <select className="input w-56" value={draft.autoLockMinutes} onChange={(e) => set('autoLockMinutes', Number(e.target.value))}>
            {[2, 5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                After {m} minutes
              </option>
            ))}
            <option value={0}>Never (not recommended)</option>
          </select>
          <button className="btn-primary" onClick={save}>
            <Save size={16} /> Save
          </button>
        </div>
      </Section>

      <Section title="Change my PIN">
        <ChangePinForm />
      </Section>

      {user.role === 'owner' && <ServerLinkCard />}

      <ul className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        <li>• PINs are stored as salted PBKDF2 hashes — not even the owner can read them.</li>
        <li>• 5 wrong PINs lock that account for 30 seconds, doubling with each further miss (up to 15 minutes).</li>
        <li>• A PIN set by the owner for someone else must be replaced by them at their next sign-in.</li>
        <li>• The shop server only accepts changes from signed-in staff, with their role checked on every request.</li>
      </ul>
    </>
  )
}

function ServerLinkCard() {
  const { user } = useSession()
  const toast = useToast()
  const [link, setLink] = useState<ServerLink | null>(null)
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => void serverLink().then(setLink)
  useEffect(refresh, [])

  const connect = async () => {
    if (!user) return
    if (!verifyPin(pin, user.pinHash)) return toast('That is not your PIN', 'error')
    setBusy(true)
    try {
      if (link === 'needs-setup') await registerWithServer(user, pin, code)
      else await reconnectServer(user, pin)
      await pushUsers()
      await logActivity('system', link === 'needs-setup' ? 'Till registered with the shop server' : 'Reconnected to the shop server', { userId: user.id, userName: user.name })
      toast('Connected to the shop server')
      setPin('')
      setCode('')
      refresh()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const label: Record<ServerLink, [string, string]> = {
    connected: ['Connected', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
    'needs-setup': ['Not registered', 'bg-amber-50 text-amber-800 ring-amber-200'],
    'signed-out': ['Not signed in', 'bg-amber-50 text-amber-800 ring-amber-200'],
    offline: ['Unreachable', 'bg-slate-100 text-slate-600 ring-slate-200'],
  }

  return (
    <Section title="Shop server" desc="Staff accounts, STK Push and network printing go through the shop server. The till keeps selling without it.">
      <div className="flex flex-wrap items-center gap-3">
        {link && <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${label[link][1]}`}>{label[link][0]}</span>}
        <button className="text-xs font-semibold text-brand-600" onClick={refresh}>
          Check again
        </button>
      </div>
      {(link === 'needs-setup' || link === 'signed-out') && (
        <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          {link === 'needs-setup' && (
            <Field label="Server setup code" hint="SETUP_CODE in the server's .env (printed by deploy.sh)">
              <input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            </Field>
          )}
          <Field label="Your PIN">
            <input className="input font-mono tracking-[0.3em]" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <button className="btn-primary" disabled={busy || pin.length < 4} onClick={() => void connect()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} {link === 'needs-setup' ? 'Register this till' : 'Connect'}
          </button>
        </div>
      )}
      {link === 'offline' && <p className="mt-2 text-xs text-slate-500">Check the server is running and the address under Payments → Local server.</p>}
    </Section>
  )
}

// ---------------------------------------------------------------- Sync

const SYNC_ROWS: [string, string][] = [
  ['products', 'Parts'],
  ['units', 'Serial labels'],
  ['movements', 'Stock movements'],
  ['sales', 'Sales & refunds'],
  ['customers', 'Customers'],
  ['purchaseOrders', 'Purchase orders'],
  ['suppliers', 'Suppliers'],
  ['jobs', 'Service jobs'],
  ['shifts', 'Shifts'],
  ['logs', 'Activity log'],
]

function SyncSettings() {
  const toast = useToast()
  const { user } = useSession()
  const s = useSyncStatus()
  const [server, setServer] = useState<{ counts: Record<string, number>; tills: { number: number; label: string | null; last_seen: number }[] } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const local = useLiveQuery(async () => {
    const out: Record<string, number> = {}
    for (const [t] of SYNC_ROWS) out[t] = await db.table(t).count()
    return out
  }, [], null)
  const label = syncLabel(s)

  const loadServer = async () => {
    try {
      setServer(await api('/sync/status'))
      setErr('')
    } catch (e) {
      setServer(null)
      setErr(errorText(e))
    }
  }
  useEffect(() => {
    void loadServer()
  }, [s.lastSync])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      await loadServer()
      toast(ok)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const allSynced = s.state === 'idle' && s.pending === 0

  return (
    <>
      <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${allSynced ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <div>
          <div className={`text-base font-bold ${allSynced ? 'text-emerald-800' : 'text-amber-900'}`}>
            {allSynced ? 'Everything on this till is on the shop server' : label.text}
          </div>
          <div className="mt-0.5 text-sm text-slate-600">
            Last synced {ago(s.lastSync)} · this is till <b>#{currentTill()}</b>
            {s.error ? ` · ${s.error}` : ''}
          </div>
        </div>
        <button className="btn-primary" disabled={busy || s.state === 'syncing'} onClick={() => run(syncNow, 'Sync finished')}>
          <RefreshCw size={16} className={s.state === 'syncing' ? 'animate-spin' : ''} /> Sync now
        </button>
      </div>

      {s.state === 'signed-out' && (
        <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          This till is not connected to the shop server. {user?.role === 'owner' ? 'Connect it under Security → Shop server, or lock the till and sign in again while online.' : 'Lock the till and sign in again while online.'}
        </p>
      )}

      <Section title="This till vs the shop server" desc="Counts should match once everything has synced (the server also holds other tills' records).">
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Records</th>
                <th className="px-3 py-2 text-right">This till</th>
                <th className="px-3 py-2 text-right">Shop server</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {SYNC_ROWS.map(([t, name]) => {
                const a = local?.[t]
                const b = server?.counts[t] ?? (server ? 0 : undefined)
                return (
                  <tr key={t}>
                    <td className="px-3 py-2 text-slate-700">{name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a ?? '…'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${a !== undefined && b !== undefined && b < a ? 'font-semibold text-amber-700' : ''}`}>{b ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {err && <p className="mt-2 text-xs text-red-600">Server: {err}</p>}
      </Section>

      {server && server.tills.length > 0 && (
        <Section title="Tills connected to this shop">
          <div className="flex flex-wrap gap-2">
            {server.tills.map((t) => (
              <span key={t.number} className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${t.number === currentTill() ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-white text-slate-700 ring-slate-200'}`}>
                Till #{t.number}
                {t.number === currentTill() && ' (this one)'} · seen {ago(t.last_seen)}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Repair" desc="Only needed if counts above don't line up after a sync.">
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => run(async () => (await queueAllForUpload(), await syncNow()), 'Everything on this till was sent again')}>
            Upload everything on this till again
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => run(redownloadAll, "Downloaded the server's copy again")}>
            Download everything from the server again
          </button>
        </div>
      </Section>

      <ul className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        <li>• Every sale, stock change, part, customer and setting is queued the moment it happens and sent within seconds; nothing is lost while offline — it goes when the connection returns.</li>
        <li>• Deleting a part deletes it on every till. A factory reset only clears this till; its data comes back from the server at the next sign-in.</li>
        <li>• Stock is rebuilt from stock movements, so two tills selling the same part never overwrite each other's counts.</li>
        <li>• The server keeps its copy in <code>data/optimas.db</code> — back that file up together with the daily JSON backup.</li>
      </ul>
    </>
  )
}

// ---------------------------------------------------------------- Backup

function BackupSettings() {
  const toast = useToast()
  const { user } = useSession()
  const archive = useLiveQuery(() => db.kv.get(PRE_PRODUCTION_ARCHIVE), [])
  const archived = archive?.value as { at: number; data: Record<string, unknown[]> } | undefined
  const archivedRows = archived ? Object.values(archived.data).reduce((n, rows) => n + rows.length, 0) : 0

  const backup = async () => {
    const data: Record<string, unknown> = {}
    for (const t of db.tables) {
      // The pre-production archive is downloaded separately; don't bloat daily backups with it.
      data[t.name] = t.name === 'kv' ? (await t.toArray()).filter((r) => (r as { key: string }).key !== PRE_PRODUCTION_ARCHIVE) : await t.toArray()
    }
    download(`optimas-backup-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`, JSON.stringify({ version: db.verno, exportedAt: Date.now(), data }), 'application/json')
    await logActivity('system', 'Backup downloaded', { userId: user?.id, userName: user?.name })
  }

  const restore = async (file: File) => {
    if (!confirm('Restoring replaces ALL data on this till with the backup. Continue?')) return
    try {
      const parsed = JSON.parse(await file.text()) as { data?: Record<string, unknown[]> }
      const data = parsed.data
      if (!data || typeof data !== 'object' || !Array.isArray(data.users)) throw new Error('This is not an Optimas POS backup file')
      // Backups from before hashed PINs carry plain PINs: hash them on the way in.
      const users = (data.users as (User & { pin?: string })[]).map((u) => {
        if (isPinHash(u.pinHash)) return u
        const { pin, ...rest } = u
        return { ...rest, pinHash: hashPin(pin ?? ''), mustChangePin: true }
      })
      if (!users.some((u) => u.role === 'owner' && u.active)) throw new Error('The backup has no active owner account — restoring it would lock you out')
      // Local restore (the transaction includes syncstate, so nothing is queued
      // as it happens); restored records are then queued for upload — puts only,
      // so restoring on one till never deletes data other tills put on the server.
      const keepTill = (await db.kv.toArray()).filter((r) => String(r.key).startsWith('till:'))
      await db.transaction('rw', db.tables, async () => {
        for (const t of db.tables) {
          if (t.name === 'syncstate') continue
          await t.clear()
          if (t.name === 'outbox') continue
          let rows = t.name === 'users' ? users : data[t.name]
          if (t.name === 'kv') rows = [...(Array.isArray(rows) ? rows : []).filter((r) => !String((r as { key: string }).key).startsWith('till:')), ...keepTill]
          if (Array.isArray(rows) && rows.length) await t.bulkAdd(rows)
        }
        await db.syncstate.delete('pull:rev')
      })
      await queueAllForUpload()
      toast('Backup restored — sign in again')
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      toast(`Restore failed: ${errorText(e)}`, 'error')
    }
  }

  const downloadArchive = () => {
    if (!archived) return
    download(`optimas-pre-production-archive-${new Date(archived.at).toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 2, exportedAt: archived.at, data: archived.data }), 'application/json')
  }

  const deleteArchive = async () => {
    if (!confirm('Delete the archive of the old test data for good?')) return
    await db.kv.delete(PRE_PRODUCTION_ARCHIVE)
    await logActivity('system', 'Pre-production archive deleted', { userId: user?.id, userName: user?.name })
    toast('Archive deleted')
  }

  return (
    <>
      <p className="mb-4 text-sm text-slate-600">
        All data lives on this computer (works offline). Download a backup at least daily and keep it on a flash disk or Google Drive.
      </p>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={backup}>
          Download backup
        </button>
        <label className="btn-ghost cursor-pointer">
          Restore from file
          <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        </label>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        The backup JSON contains every table — products, serial labels, sales, customers, jobs, staff (PIN hashes only), settings and the activity log. Keep it private.
      </p>

      {archived && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="font-semibold text-amber-900">Old test data archive</div>
          <p className="mt-1 text-sm text-amber-800">
            When this till was prepared for production on {new Date(archived.at).toLocaleDateString('en-KE', { dateStyle: 'medium' })}, {archivedRows} demo/test records were removed
            and kept here in case anything real was among them.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost" onClick={downloadArchive}>
              <Download size={16} /> Download archive
            </button>
            <button className="btn-ghost text-red-600" onClick={() => void deleteArchive()}>
              <Trash2 size={16} /> Delete archive
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- About

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

function AboutSettings() {
  const toast = useToast()
  const [usage, setUsage] = useState<number | null>(null)
  const [quota, setQuota] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    navigator.storage
      ?.estimate()
      .then((e) => {
        if (!alive) return
        setUsage(e.usage ?? null)
        setQuota(e.quota ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const counts = useLiveQuery(
    async () => ({
      products: await db.products.count(),
      units: await db.units.where('status').equals('in_stock').count(),
      customers: await db.customers.count(),
      sales: await db.sales.count(),
      jobs: await db.jobs.count(),
      movements: await db.movements.count(),
      staff: await db.users.count(),
      logs: await db.logs.count(),
    }),
    [],
    null,
  )

  const reset = async () => {
    if (!confirm('Erase ALL data on this till — products, sales, customers, jobs, staff, settings?')) return
    if (!confirm('This cannot be undone (take a backup first). Reset everything?')) return
    try {
      await db.transaction('rw', db.tables, async () => {
        for (const t of db.tables) await t.clear()
      })
      window.location.reload()
    } catch (e) {
      toast(`Reset failed: ${errorText(e)}`, 'error')
    }
  }

  const rows: [string, number | undefined][] = counts
    ? [
        ['Products', counts.products],
        ['Labelled units in stock', counts.units],
        ['Customers', counts.customers],
        ['Sales receipts', counts.sales],
        ['Service jobs', counts.jobs],
        ['Stock movements', counts.movements],
        ['Staff', counts.staff],
        ['Log entries', counts.logs],
      ]
    : []

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <Database size={17} className="text-brand-600" /> Optimas POS
          </div>
          <dl className="mt-2 space-y-1 text-sm text-slate-600">
            <div className="flex justify-between">
              <dt>Version</dt>
              <dd className="font-mono font-semibold">{APP_VERSION}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Storage used</dt>
              <dd className="font-semibold">{usage != null ? fmtBytes(usage) : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Browser quota</dt>
              <dd className="font-semibold">{quota != null ? fmtBytes(quota) : '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="font-semibold text-slate-900">Data on this till</div>
          <dl className="mt-2 space-y-1 text-sm text-slate-600">
            {rows.map(([label, n]) => (
              <div key={label} className="flex justify-between">
                <dt>{label}</dt>
                <dd className="font-semibold tabular-nums">{n ?? '…'}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-600">
        Everything is stored locally in this browser (IndexedDB) and works offline. STK Push and network printing need the bundled Node server (<code>npm run server</code>). Setup docs live in <code>docs/</code> — <code>MPESA.md</code> for Daraja credentials.
      </p>

      <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2 font-semibold text-red-700">
          <AlertTriangle size={17} /> Factory reset
        </div>
        <p className="mt-1 text-sm text-red-600">
          Wipes everything stored on this till and reloads. The shop server is not touched: after signing in again, the till downloads the shop's data from it.
          To remove a part from every till, delete it in Inventory instead.
        </p>
        <button className="btn-ghost mt-3 border-red-300 text-red-600 hover:bg-red-100" onClick={reset}>
          Reset all data…
        </button>
      </div>
    </>
  )
}
