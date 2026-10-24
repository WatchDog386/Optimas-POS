// Printer transports. A thermal printer can be reached three ways:
//  - 'usb'    WebUSB, direct from Chrome/Edge (USB printers; on Windows needs the WinUSB driver)
//  - 'serial' Web Serial, for USB-serial and Bluetooth SPP printers
//  - 'network' LAN printers on port 9100, relayed through the local server (/api/print)
// When none is configured we fall back to the browser print dialog (80mm CSS layout).

export type PrinterMode = 'browser' | 'usb' | 'serial' | 'network'

export interface PrinterConfig {
  mode: PrinterMode
  host?: string
  port?: number
  model?: string
}

const CONFIG_KEY = 'optimas.printer'

export function loadPrinterConfig(): PrinterConfig {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '') as PrinterConfig
  } catch {
    return { mode: 'browser' }
  }
}

export function savePrinterConfig(cfg: PrinterConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
  } catch {
    // Storage blocked (private window); config lasts for this page load only.
  }
}

const BARCODE_CONFIG_KEY = 'optimas.barcodePrinter'

export function loadBarcodePrinterConfig(): PrinterConfig {
  try {
    return JSON.parse(localStorage.getItem(BARCODE_CONFIG_KEY) ?? '') as PrinterConfig
  } catch {
    return { mode: 'browser' }
  }
}

export function saveBarcodePrinterConfig(cfg: PrinterConfig) {
  try {
    localStorage.setItem(BARCODE_CONFIG_KEY, JSON.stringify(cfg))
  } catch {
    // Storage blocked (private window); config lasts for this page load only.
  }
}

// --- minimal typings for WebUSB / Web Serial (not in lib.dom yet) ---
interface USBEndpointLike {
  direction: 'in' | 'out'
  type: string
  endpointNumber: number
}
interface USBDeviceLike {
  opened: boolean
  configuration: { interfaces: { interfaceNumber: number; alternate: { endpoints: USBEndpointLike[] } }[] } | null
  open(): Promise<void>
  selectConfiguration(n: number): Promise<void>
  claimInterface(n: number): Promise<void>
  transferOut(ep: number, data: BufferSource): Promise<unknown>
}
interface SerialPortLike {
  writable: WritableStream<Uint8Array> | null
  open(opts: { baudRate: number }): Promise<void>
}
type Nav = Navigator & {
  usb?: { requestDevice(o: { filters: object[] }): Promise<USBDeviceLike>; getDevices(): Promise<USBDeviceLike[]> }
  serial?: { requestPort(): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> }
}
const nav = navigator as Nav

export const supports = {
  usb: () => !!nav.usb,
  serial: () => !!nav.serial,
}

let usbDevice: { dev: USBDeviceLike; endpoint: number } | null = null
let serialPort: SerialPortLike | null = null

async function prepareUsb(dev: USBDeviceLike) {
  if (!dev.opened) await dev.open()
  if (!dev.configuration) await dev.selectConfiguration(1)
  for (const iface of dev.configuration!.interfaces) {
    const out = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
    if (out) {
      await dev.claimInterface(iface.interfaceNumber)
      usbDevice = { dev, endpoint: out.endpointNumber }
      return
    }
  }
  throw new Error('No bulk OUT endpoint found on this USB device')
}

/** Ask the user to pick a printer. Must be called from a click handler. */
export async function pairPrinter(mode: 'usb' | 'serial') {
  if (mode === 'usb') {
    if (!nav.usb) throw new Error('WebUSB is not available in this browser (use Chrome or Edge)')
    await prepareUsb(await nav.usb.requestDevice({ filters: [] }))
  } else {
    if (!nav.serial) throw new Error('Web Serial is not available in this browser (use Chrome or Edge)')
    const port = await nav.serial.requestPort()
    await port.open({ baudRate: 9600 })
    serialPort = port
  }
}

async function reconnect(mode: PrinterMode) {
  // Browsers remember granted devices, so after a reload we can reconnect without a prompt.
  if (mode === 'usb' && !usbDevice && nav.usb) {
    const [dev] = await nav.usb.getDevices()
    if (dev) await prepareUsb(dev)
  }
  if (mode === 'serial' && !serialPort && nav.serial) {
    const [port] = await nav.serial.getPorts()
    if (port) {
      if (!port.writable) await port.open({ baudRate: 9600 })
      serialPort = port
    }
  }
}

export async function sendRaw(bytes: Uint8Array, cfg = loadPrinterConfig(), apiUrl = '/api'): Promise<void> {
  switch (cfg.mode) {
    case 'usb': {
      await reconnect('usb')
      if (!usbDevice) throw new Error('USB printer not paired. Open Settings → Hardware.')
      await usbDevice.dev.transferOut(usbDevice.endpoint, bytes as BufferSource)
      return
    }
    case 'serial': {
      await reconnect('serial')
      if (!serialPort?.writable) throw new Error('Serial printer not paired. Open Settings → Hardware.')
      const writer = serialPort.writable.getWriter()
      try {
        await writer.write(bytes)
      } finally {
        writer.releaseLock()
      }
      return
    }
    case 'network': {
      if (!cfg.host) throw new Error('Printer IP address not set')
      const res = await fetch(`${apiUrl}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: cfg.host, port: cfg.port ?? 9100, data: toBase64(bytes) }),
      })
      if (!res.ok) throw new Error(`Print server error: ${await res.text()}`)
      return
    }
    case 'browser':
      throw new Error('Raw printing needs a USB, serial or network printer')
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
