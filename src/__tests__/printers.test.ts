import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A fake USB printer that records what it was sent. */
function fakePrinter(productName: string) {
  return {
    productName,
    vendorId: 0x0483,
    productId: 0x5743, // Xprinter models often share IDs and have no serial number
    serialNumber: undefined as string | undefined,
    opened: false,
    configuration: { interfaces: [{ interfaceNumber: 0, claimed: false, alternate: { endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] } }] },
    received: [] as number[][],
    async open() {
      this.opened = true
    },
    async selectConfiguration() {},
    async claimInterface() {
      this.configuration.interfaces[0].claimed = true
    },
    async transferOut(_ep: number, data: Uint8Array) {
      this.received.push([...data])
    },
  }
}

let devices: ReturnType<typeof fakePrinter>[] = []
let picks: ReturnType<typeof fakePrinter>[] = []
const store = new Map<string, string>()

beforeEach(() => {
  vi.resetModules()
  store.clear()
  devices = [fakePrinter('XP-80C'), fakePrinter('XP-330B')]
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  vi.stubGlobal('navigator', {
    onLine: true,
    usb: {
      requestDevice: async () => picks.shift()!,
      getDevices: async () => devices,
    },
  })
})

describe('receipt and label printers', () => {
  it('keeps receipts on the XP-80C and labels on the XP-330B, also after a reload', async () => {
    let printer = await import('../lib/printer')
    const [xp80, xp330] = devices
    picks = [xp80, xp330]
    printer.savePrinterConfig(await printer.pairPrinter('receipt', { mode: 'usb' }))
    printer.saveBarcodePrinterConfig(await printer.pairPrinter('label', { mode: 'usb' }))

    await printer.sendRaw(new Uint8Array([1]), printer.loadPrinterConfig(), '/api', 'receipt')
    await printer.sendRaw(new Uint8Array([2]), printer.loadBarcodePrinterConfig(), '/api', 'label')
    expect(xp80.received).toEqual([[1]])
    expect(xp330.received).toEqual([[2]])

    // Reload: module state is gone; the saved configs must reopen the right devices.
    vi.resetModules()
    printer = await import('../lib/printer')
    await printer.sendRaw(new Uint8Array([3]), printer.loadBarcodePrinterConfig(), '/api', 'label')
    await printer.sendRaw(new Uint8Array([4]), printer.loadPrinterConfig(), '/api', 'receipt')
    expect(xp330.received).toEqual([[2], [3]])
    expect(xp80.received).toEqual([[1], [4]])
  })

  it('refuses to pair the label printer to the receipt printer', async () => {
    const printer = await import('../lib/printer')
    const [xp80] = devices
    picks = [xp80, xp80]
    await printer.pairPrinter('receipt', { mode: 'usb' })
    await expect(printer.pairPrinter('label', { mode: 'usb' })).rejects.toThrow(/already set up as the receipt printer/)
  })

  it('tells apart two identical printers that report no name', async () => {
    devices = [fakePrinter(''), fakePrinter('')]
    for (const d of devices) d.productName = undefined as unknown as string
    let printer = await import('../lib/printer')
    const [first, second] = devices
    // Paired "backwards": receipt = second device, label = first.
    picks = [second, first]
    printer.savePrinterConfig(await printer.pairPrinter('receipt', { mode: 'usb' }))
    printer.saveBarcodePrinterConfig(await printer.pairPrinter('label', { mode: 'usb' }))
    vi.resetModules()
    printer = await import('../lib/printer')
    await printer.sendRaw(new Uint8Array([7]), printer.loadPrinterConfig(), '/api', 'receipt')
    await printer.sendRaw(new Uint8Array([8]), printer.loadBarcodePrinterConfig(), '/api', 'label')
    expect(second.received).toEqual([[7]])
    expect(first.received).toEqual([[8]])
  })
})
