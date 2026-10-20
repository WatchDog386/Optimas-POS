import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, Bell, Bike, CreditCard, Database, Download, Info, Loader2, PackageSearch, Percent, Printer, Save, ShieldCheck, Smartphone, Store, Trash2, UserRound } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { saveSettings, useSettings } from '../db/settings'
import type { PaymentMethod, Settings } from '../db/types'
import { loadPrinterConfig, pairPrinter, savePrinterConfig, sendRaw, supports, type PrinterConfig } from '../lib/printer'
import { drawerKickBytes, testPageBytes } from '../lib/escpos'
import { download } from '../lib/csv'
import { money, toCents } from '../lib/money'
import { useSession } from '../session'
import { PageHeader, errorText, useToast } from '../components/ui'
import ChangePinForm from '../components/ChangePinForm'

const TABS = ['Shop & receipt', 'Taxes', 'Payments', 'Hardware', 'Bike models', 'Notifications', 'Security', 'Backup', 'About'] as const
type Tab = (typeof TABS)[number]

const APP_VERSION = '0.1.0'

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
      { id: 'Backup', icon: Download, tint: 'bg-teal-100 text-teal-600', desc: 'Download, restore and protect your data.' },
      { id: 'About', icon: Info, tint: 'bg-cyan-100 text-cyan-700', desc: 'Version, storage usage and factory reset.' },
    ],
  },
]

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items)
const DESCS = Object.fromEntries(ALL_ITEMS.map((i) => [i.id, i.desc])) as Record<Tab, string>

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Shop & receipt')
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
              <h2 className="text-xl font-bold tracking-tight text-slate-900">{tab}</h2>
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

function HardwareSettings() {
  const { draft, set, save } = useDraft()
  const toast = useToast()
  const [cfg, setCfg] = useState<PrinterConfig>(loadPrinterConfig)

  const update = (c: PrinterConfig) => {
    setCfg(c)
    savePrinterConfig(c)
  }
  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn()
      toast(ok)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <>
      <h3 className="mb-2 font-semibold">Receipt printer</h3>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {(
          [
            ['browser', 'Browser print'],
            ['usb', 'USB (WebUSB)'],
            ['serial', 'Serial / Bluetooth'],
            ['network', 'Network (LAN)'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={cfg.mode === m ? 'btn-dark' : 'btn-ghost'} onClick={() => update({ ...cfg, mode: m })}>
            {label}
          </button>
        ))}
      </div>
      {cfg.mode === 'browser' && <p className="mb-3 text-sm text-slate-600">Uses the system print dialog with an 80mm layout. Works with any installed printer driver but cannot open the cash drawer.</p>}
      {(cfg.mode === 'usb' || cfg.mode === 'serial') && (
        <div className="mb-3 flex items-center gap-3">
          <button className="btn-primary" onClick={() => run(() => pairPrinter(cfg.mode as 'usb' | 'serial'), 'Printer paired')}>
            Pair printer
          </button>
          <span className="text-sm text-slate-500">
            {cfg.mode === 'usb' ? (supports.usb() ? 'Chrome/Edge required. On Windows install the WinUSB driver with Zadig.' : 'WebUSB not supported in this browser.') : supports.serial() ? 'For USB-serial and paired Bluetooth printers.' : 'Web Serial not supported in this browser.'}
          </span>
        </div>
      )}
      {cfg.mode === 'network' && (
        <div className="mb-3 grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Printer IP address">
              <input className="input font-mono" placeholder="192.168.1.50" value={cfg.host ?? ''} onChange={(e) => update({ ...cfg, host: e.target.value })} />
            </Field>
          </div>
          <Field label="Port">
            <input className="input" type="number" value={cfg.port ?? 9100} onChange={(e) => update({ ...cfg, port: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-2">
        <button className="btn-ghost" disabled={cfg.mode === 'browser'} onClick={() => run(() => sendRaw(testPageBytes(draft), cfg, draft.apiUrl), 'Test page sent')}>
          Print test page
        </button>
        <button className="btn-ghost" disabled={cfg.mode === 'browser'} onClick={() => run(() => sendRaw(drawerKickBytes(), cfg, draft.apiUrl), 'Drawer kick sent')}>
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

      <h3 className="mb-1 mt-6 font-semibold">Barcode scanner</h3>
      <p className="text-sm text-slate-600">
        Any USB or Bluetooth scanner in keyboard (HID) mode works with no setup. Set it to send <b>Enter</b> after each scan. Scan anywhere on the Sell screen to add the part to the sale.
      </p>
      <SaveBar onSave={save} />
    </>
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

  if (!user) return null

  return (
    <>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-brand-600" />
        <div className="text-sm text-slate-600">
          You are signed in as <b className="text-slate-900">{user.name}</b> ({user.role}). Lock the till when you step away — every sale, refund and settings change is recorded against your name in the activity log.
        </div>
      </div>

      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">Change my PIN</h3>
      <ChangePinForm />

      <p className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        PINs are stored only on this device. To add, disable or re-role staff members, open <b>Staff</b> from the sidebar (owner only) — or your own details from <b>My profile</b> in the top-right menu.
      </p>
    </>
  )
}

// ---------------------------------------------------------------- Backup

function BackupSettings() {
  const toast = useToast()
  const backup = async () => {
    const data: Record<string, unknown> = {}
    for (const t of db.tables) data[t.name] = await t.toArray()
    download(`optimas-backup-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`, JSON.stringify({ version: 1, exportedAt: Date.now(), data }), 'application/json')
  }
  const restore = async (file: File) => {
    if (!confirm('Restoring replaces ALL data on this till with the backup. Continue?')) return
    try {
      const { data } = JSON.parse(await file.text()) as { data: Record<string, unknown[]> }
      await db.transaction('rw', db.tables, async () => {
        for (const t of db.tables) {
          await t.clear()
          if (data[t.name]) await t.bulkAdd(data[t.name])
        }
      })
      toast('Backup restored')
    } catch (e) {
      toast(`Restore failed: ${errorText(e)}`, 'error')
    }
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
        The backup JSON contains every table — products, sales, customers, jobs, staff, settings and the activity log. Restore it on any till running this app.
      </p>
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
          Wipes every table and reloads. The sample catalogue and default Owner (PIN 1234) / Cashier (PIN 0000) accounts come back on the next start.
        </p>
        <button className="btn-ghost mt-3 border-red-300 text-red-600 hover:bg-red-100" onClick={reset}>
          Reset all data…
        </button>
      </div>
    </>
  )
}
