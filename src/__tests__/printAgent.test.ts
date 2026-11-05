import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_URL, agentPrinters, agentStatus, guessPrinter, sendRaw } from '../lib/printer'
import { agentInstallerCmd } from '../lib/agentInstaller'

const WINDOWS_PRINTERS = ['Microsoft Print to PDF', 'XP-80C', 'Xprinter XP-330B', 'OneNote']

/** Stands in for the local print agent and records every job it receives. */
function fakeAgent() {
  const jobs: { printer: string; data: string; name: string }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(AGENT_URL, '')
    if (path === '/status') return new Response(JSON.stringify({ ok: true, agent: 'optimas-print-agent', version: '1.0.0' }))
    if (path === '/printers') return new Response(JSON.stringify({ printers: WINDOWS_PRINTERS }))
    if (path === '/print') {
      jobs.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ ok: true }))
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { jobs, fetchMock }
}

afterEach(() => vi.unstubAllGlobals())

describe('print agent', () => {
  it('picks the XP-330B for labels and the XP-80C for receipts', () => {
    expect(guessPrinter(WINDOWS_PRINTERS, 'label')).toBe('Xprinter XP-330B')
    expect(guessPrinter(WINDOWS_PRINTERS, 'receipt')).toBe('XP-80C')
  })

  it('lists Windows printers and reports its version', async () => {
    fakeAgent()
    expect(await agentStatus()).toBe('1.0.0')
    expect(await agentPrinters()).toEqual(WINDOWS_PRINTERS)
  })

  it('sends label jobs to the label printer and receipts to the receipt printer', async () => {
    const { jobs } = fakeAgent()
    await sendRaw(new Uint8Array([1, 2, 3]), { mode: 'agent', printerName: 'Xprinter XP-330B' }, '/api', 'label')
    await sendRaw(new Uint8Array([4, 5]), { mode: 'agent', printerName: 'XP-80C' }, '/api', 'receipt')
    expect(jobs.map((j) => j.printer)).toEqual(['Xprinter XP-330B', 'XP-80C'])
    expect(atob(jobs[0].data)).toBe('\x01\x02\x03')
  })

  it('refuses to print before a Windows printer is chosen', async () => {
    const { jobs } = fakeAgent()
    await expect(sendRaw(new Uint8Array([1]), { mode: 'agent' }, '/api', 'label')).rejects.toThrow(/labels/)
    expect(jobs).toHaveLength(0)
  })

  it('reports a missing agent instead of hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await agentStatus()).toBeNull()
  })

  it('builds a Windows installer locked to the shop address', () => {
    const cmd = agentInstallerCmd('https://pos.optimaswifi.co.ke')
    expect(cmd).toContain('https://pos.optimaswifi.co.ke/print-agent/optimas-print-agent.ps1')
    expect(cmd).toContain('-AllowedOrigins https://pos.optimaswifi.co.ke')
    expect(cmd.split('\r\n').length).toBeGreaterThan(5)
    expect(() => agentInstallerCmd('https://evil.example/"&del')).toThrow()
  })
})
