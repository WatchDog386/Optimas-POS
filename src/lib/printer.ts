// Printer transports. A thermal or label printer can be reached three ways:
//  - 'usb'     WebUSB, direct from Chrome/Edge (on Windows the printer needs the WinUSB driver)
//  - 'serial'  Web Serial, for USB-serial and Bluetooth SPP printers
//  - 'network' LAN printers on port 9100, relayed through the shop server (/api/print)
// When none is configured we fall back to the browser print dialog.
//
// The receipt printer and the barcode label printer are separate "slots": each
// remembers which physical device it was paired with, so pairing one never
// redirects the other.

import { authHeaders } from './api'

export type PrinterMode = 'browser' | 'usb' | 'serial' | 'network'
export type PrinterSlot = 'receipt' | 'label'

export interface DeviceId {
  vendorId?: number
  productId?: number
  serialNumber?: string
}

export interface PrinterConfig {
  mode: PrinterMode
  host?: string
  port?: number
  /** Serial baud rate (Xprinter default 9600; many Bluetooth modules 115200). */
  baudRate?: number
  /** The paired device, so the right one is reopened after a reload. */
  device?: DeviceId
  /** Friendly name shown in Settings. */
  deviceName?: string
}

const KEYS: Record<PrinterSlot, string> = { receipt: 'optimas.printer', label: 'optimas.barcodePrinter' }

function load(slot: PrinterSlot): PrinterConfig {
  try {
    const cfg = JSON.parse(localStorage.getItem(KEYS[slot]) ?? '') as PrinterConfig
    return cfg && typeof cfg.mode === 'string' ? cfg : { mode: 'browser' }
  } catch {
    return { mode: 'browser' }
  }
}

function save(slot: PrinterSlot, cfg: PrinterConfig) {
  try {
    localStorage.setItem(KEYS[slot], JSON.stringify(cfg))
  } catch {
    // Storage blocked (private window); config lasts for this page load only.
  }
}

export const loadPrinterConfig = () => load('receipt')
export const savePrinterConfig = (cfg: PrinterConfig) => save('receipt', cfg)
export const loadBarcodePrinterConfig = () => load('label')
export const saveBarcodePrinterConfig = (cfg: PrinterConfig) => save('label', cfg)

// --- minimal typings for WebUSB / Web Serial (not in lib.dom yet) ---
interface USBEndpointLike {
  direction: 'in' | 'out'
  type: string
  endpointNumber: number
}
interface USBDeviceLike {
  opened: boolean
  vendorId: number
  productId: number
  serialNumber?: string
  productName?: string
  manufacturerName?: string
  configuration: { interfaces: { interfaceNumber: number; claimed?: boolean; alternate: { endpoints: USBEndpointLike[] } }[] } | null
  open(): Promise<void>
  selectConfiguration(n: number): Promise<void>
  claimInterface(n: number): Promise<void>
  transferOut(ep: number, data: BufferSource): Promise<unknown>
}
interface SerialPortLike {
  writable: WritableStream<Uint8Array> | null
  open(opts: { baudRate: number }): Promise<void>
  getInfo?(): { usbVendorId?: number; usbProductId?: number }
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

const usbOpen: Partial<Record<PrinterSlot, { dev: USBDeviceLike; endpoint: number }>> = {}
const serialOpen: Partial<Record<PrinterSlot, SerialPortLike>> = {}

async function prepareUsb(dev: USBDeviceLike): Promise<number> {
  if (!dev.opened) await dev.open()
  if (!dev.configuration) await dev.selectConfiguration(1)
  for (const iface of dev.configuration!.interfaces) {
    const out = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
    if (out) {
      if (!iface.claimed) await dev.claimInterface(iface.interfaceNumber)
      return out.endpointNumber
    }
  }
  throw new Error('No bulk OUT endpoint found on this USB device')
}

const sameUsb = (d: USBDeviceLike, id?: DeviceId) =>
  !!id && d.vendorId === id.vendorId && d.productId === id.productId && (!id.serialNumber || d.serialNumber === id.serialNumber)

/**
 * Ask the user to pick a printer for a slot. Must be called from a click
 * handler. Returns the updated config (device remembered) — save it.
 */
export async function pairPrinter(slot: PrinterSlot, cfg: PrinterConfig): Promise<PrinterConfig> {
  if (cfg.mode === 'usb') {
    if (!nav.usb) throw new Error('WebUSB is not available in this browser (use Chrome or Edge)')
    const dev = await nav.usb.requestDevice({ filters: [] })
    const endpoint = await prepareUsb(dev)
    usbOpen[slot] = { dev, endpoint }
    return {
      ...cfg,
      device: { vendorId: dev.vendorId, productId: dev.productId, serialNumber: dev.serialNumber },
      deviceName: [dev.manufacturerName, dev.productName].filter(Boolean).join(' ') || `USB ${hex(dev.vendorId)}:${hex(dev.productId)}`,
    }
  }
  if (cfg.mode === 'serial') {
    if (!nav.serial) throw new Error('Web Serial is not available in this browser (use Chrome or Edge)')
    const port = await nav.serial.requestPort()
    if (!port.writable) await port.open({ baudRate: cfg.baudRate ?? 9600 })
    serialOpen[slot] = port
    const info = port.getInfo?.() ?? {}
    return {
      ...cfg,
      device: { vendorId: info.usbVendorId, productId: info.usbProductId },
      deviceName: info.usbVendorId ? `Serial ${hex(info.usbVendorId)}:${hex(info.usbProductId ?? 0)}` : 'Serial / Bluetooth port',
    }
  }
  throw new Error('Only USB and serial printers need pairing')
}

const hex = (n: number) => n.toString(16).padStart(4, '0')

/** Browsers remember granted devices, so after a reload we reopen the right one without a prompt. */
async function reconnect(slot: PrinterSlot, cfg: PrinterConfig) {
  if (cfg.mode === 'usb' && !usbOpen[slot] && nav.usb) {
    const devices = await nav.usb.getDevices()
    const dev = devices.find((d) => sameUsb(d, cfg.device)) ?? (cfg.device ? undefined : devices.length === 1 ? devices[0] : undefined)
    if (dev) usbOpen[slot] = { dev, endpoint: await prepareUsb(dev) }
  }
  if (cfg.mode === 'serial' && !serialOpen[slot] && nav.serial) {
    const ports = await nav.serial.getPorts()
    const match = ports.find((p) => {
      const info = p.getInfo?.() ?? {}
      return cfg.device?.vendorId !== undefined && info.usbVendorId === cfg.device.vendorId && info.usbProductId === cfg.device.productId
    })
    const port = match ?? (ports.length === 1 ? ports[0] : undefined)
    if (port) {
      if (!port.writable) await port.open({ baudRate: cfg.baudRate ?? 9600 })
      serialOpen[slot] = port
    }
  }
}

/** Large jobs (dozens of labels) go out in chunks so small printer buffers keep up. */
const CHUNK = 16 * 1024

export async function sendRaw(bytes: Uint8Array, cfg = loadPrinterConfig(), apiUrl = '/api', slot: PrinterSlot = 'receipt'): Promise<void> {
  switch (cfg.mode) {
    case 'usb': {
      await reconnect(slot, cfg)
      const usb = usbOpen[slot]
      if (!usb) throw new Error(`${slot === 'label' ? 'Label' : 'Receipt'} printer not paired. Open Settings → Hardware and press Pair.`)
      try {
        for (let i = 0; i < bytes.length; i += CHUNK) await usb.dev.transferOut(usb.endpoint, bytes.subarray(i, i + CHUNK) as BufferSource)
      } catch (e) {
        delete usbOpen[slot] // unplugged — reconnect next time
        throw e
      }
      return
    }
    case 'serial': {
      await reconnect(slot, cfg)
      const port = serialOpen[slot]
      if (!port?.writable) throw new Error(`${slot === 'label' ? 'Label' : 'Receipt'} printer not paired. Open Settings → Hardware and press Pair.`)
      const writer = port.writable.getWriter()
      try {
        for (let i = 0; i < bytes.length; i += CHUNK) await writer.write(bytes.subarray(i, i + CHUNK))
      } finally {
        writer.releaseLock()
      }
      return
    }
    case 'network': {
      if (!cfg.host) throw new Error('Printer IP address not set')
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ host: cfg.host, port: cfg.port ?? 9100, data: toBase64(bytes) }),
      })
      if (res.status === 401) throw new Error('Not signed in to the shop server — lock the till and sign in again')
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
