import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Save, Trash2 } from 'lucide-react'
import { db } from '../db/db'
import { saveSettings, useSettings } from '../db/settings'
import type { Role, Settings, User } from '../db/types'
import { loadPrinterConfig, pairPrinter, savePrinterConfig, sendRaw, supports, type PrinterConfig } from '../lib/printer'
import { drawerKickBytes, testPageBytes } from '../lib/escpos'
import { download } from '../lib/csv'
import { PIN_LENGTH, useSession } from '../session'
import { ListPanel, Modal, PageHeader, errorText, useToast } from '../components/ui'

const TABS = ['Shop & receipt', 'Payments', 'Hardware', 'Users', 'Bike models', 'Backup'] as const
type Tab = (typeof TABS)[number]

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Shop & receipt')
  return (
    <div className="p-6">
      <PageHeader title="Settings" />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'btn-dark' : 'btn-ghost'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="card max-w-3xl p-5">
        {tab === 'Shop & receipt' && <ShopSettings />}
        {tab === 'Payments' && <PaymentSettings />}
        {tab === 'Hardware' && <HardwareSettings />}
        {tab === 'Users' && <UserSettings />}
        {tab === 'Bike models' && <BikeSettings />}
        {tab === 'Backup' && <BackupSettings />}
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

function SaveBar({ onSave }: { onSave: () => void }) {
  return (
    <div className="mt-5 flex justify-end">
      <button className="btn-primary" onClick={onSave}>
        <Save size={16} /> Save
      </button>
    </div>
  )
}

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
        <Field label="VAT rate %">
          <input className="input" type="number" min={0} value={draft.vatRate} onChange={(e) => set('vatRate', Number(e.target.value))} />
        </Field>
        <Field label="Prices">
          <select className="input" value={draft.pricesIncludeVat ? 'incl' : 'excl'} onChange={(e) => set('pricesIncludeVat', e.target.value === 'incl')}>
            <option value="incl">Shelf prices include VAT</option>
            <option value="excl">VAT added at checkout</option>
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Receipt footer">
            <textarea className="input" rows={2} value={draft.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} />
          </Field>
        </div>
      </div>
      <SaveBar onSave={save} />
    </>
  )
}

function PaymentSettings() {
  const { draft, set, save } = useDraft()
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="M-Pesa Till / Paybill number" hint="Shown on the payment screen and receipt.">
          <input className="input" value={draft.mpesaTill} onChange={(e) => set('mpesaTill', e.target.value)} />
        </Field>
        <Field label="M-Pesa mode">
          <select className="input" value={draft.mpesaMode} onChange={(e) => set('mpesaMode', e.target.value as Settings['mpesaMode'])}>
            <option value="manual">Manual — cashier types the confirmation code</option>
            <option value="stk">STK Push — prompt sent to the customer's phone</option>
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Local server URL" hint="Runs server/index.ts. Handles M-Pesa STK Push (Daraja) and network printers. Default /api works when the app is served by that server.">
            <input className="input font-mono" value={draft.apiUrl} onChange={(e) => set('apiUrl', e.target.value)} />
          </Field>
        </div>
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        STK Push needs Safaricom Daraja credentials in the server's <code>.env</code> file. See <code>docs/MPESA.md</code>. Manual mode works with no setup and no internet.
      </p>
      <SaveBar onSave={save} />
    </>
  )
}

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

function UserSettings() {
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const { user: me } = useSession()
  const [edit, setEdit] = useState<Partial<User> | null>(null)
  return (
    <>
      <div className="mb-3 flex justify-between">
        <h3 className="font-semibold">Staff</h3>
        <button className="btn-primary" onClick={() => setEdit({ role: 'cashier', active: true })}>
          <Plus size={16} /> Add staff
        </button>
      </div>
      <ListPanel title="Staff" footer={<span>{users.length} user{users.length === 1 ? '' : 's'}</span>}>
        <table className="w-full">
          <thead className="table-head">
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="table-row cursor-pointer hover:bg-slate-50" onClick={() => setEdit(u)}>
                <td className="font-semibold">
                  {u.name} {u.id === me?.id && <span className="text-xs text-slate-400">(you)</span>}
                </td>
                <td className="capitalize">{u.role}</td>
                <td>{u.active ? 'Active' : 'Disabled'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListPanel>
      <p className="mt-3 text-xs text-slate-500">Owner: everything. Manager: refunds, inventory, purchasing, reports. Cashier: selling, discounts, customers, service jobs.</p>
      {edit && <UserModal user={edit} users={users} onClose={() => setEdit(null)} />}
    </>
  )
}

function UserModal({ user, users, onClose }: { user: Partial<User>; users: User[]; onClose: () => void }) {
  const toast = useToast()
  const [u, setU] = useState(user)
  const save = async () => {
    try {
      if (!u.name?.trim()) throw new Error('Name is required')
      if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(u.pin ?? '')) throw new Error(`PIN must be ${PIN_LENGTH} digits`)
      if (users.some((x) => x.pin === u.pin && x.id !== u.id)) throw new Error('That PIN is already used')
      const remainingOwners = users.filter((x) => x.role === 'owner' && x.active && x.id !== u.id).length
      if (remainingOwners === 0 && (u.role !== 'owner' || !u.active)) throw new Error('Keep at least one active owner')
      const rec = { ...u, name: u.name.trim() } as User
      if (rec.id === undefined) delete rec.id
      await db.users.put(rec)
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  return (
    <Modal title={u.id ? `Edit ${user.name}` : 'Add staff'} onClose={onClose} footer={<button className="btn-primary" onClick={save}>Save</button>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className="input" value={u.name ?? ''} onChange={(e) => setU({ ...u, name: e.target.value })} autoFocus />
        </Field>
        <Field label={`PIN (${PIN_LENGTH} digits)`}>
          <input className="input font-mono" inputMode="numeric" maxLength={PIN_LENGTH} value={u.pin ?? ''} onChange={(e) => setU({ ...u, pin: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Role">
          <select className="input" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
        </Field>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={u.active} onChange={(e) => setU({ ...u, active: e.target.checked })} /> Active
        </label>
      </div>
    </Modal>
  )
}

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
    </>
  )
}
