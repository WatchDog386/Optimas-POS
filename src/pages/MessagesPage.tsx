import { useMemo, useState } from 'react'
import { ArrowLeft, Inbox, Pencil, Search, Send } from 'lucide-react'
import { Badge, Empty, Modal, PageHeader, Segmented, useToast, errorText } from '../components/ui'

interface Message {
  id: number
  from: string
  to: string
  subject: string
  body: string[]
  at: number
  folder: 'inbox' | 'sent'
}

const NOW = Date.now()
const DAY = 86_400_000

const SEED: Message[] = [
  {
    id: 1,
    from: 'AutoSpares Ltd <orders@autospares.co.ke>',
    to: 'shop@optimas.co.ke',
    subject: 'PO-000012 confirmed — dispatching tomorrow',
    body: [
      'Hi,',
      'We confirm receipt of your purchase order PO-000012 for 24 chain sprockets and 12 inner tubes. The goods will be dispatched tomorrow morning and delivered to your Nairobi address.',
      'Attached invoice is due on the 30th of this month.',
      'Regards, AutoSpares Ltd',
    ],
    at: NOW - DAY * 0.2,
    folder: 'inbox',
  },
  {
    id: 2,
    from: 'M-Pesa <no-reply@safaricom.co.ke>',
    to: 'shop@optimas.co.ke',
    subject: 'Daily statement — yesterday\'s transactions',
    body: [
      'Your till statement for yesterday is ready.',
      'Total received: KES 48,250 across 32 transactions.',
      'You can reconcile these against your sales report in the app.',
    ],
    at: NOW - DAY * 0.8,
    folder: 'inbox',
  },
  {
    id: 3,
    from: 'Grace Wanjiku <grace.w@gmail.com>',
    to: 'shop@optimas.co.ke',
    subject: 'Quote request — Ekon 500 battery pack',
    body: [
      'Hello,',
      'I need a price for a replacement 60V 20Ah battery pack for an Ekon 500. Do you have it in stock, and can you fit it this week?',
      'Thanks, Grace',
    ],
    at: NOW - DAY * 1.5,
    folder: 'inbox',
  },
  {
    id: 4,
    from: 'KRA iTax <noreply@itax.kra.go.ke>',
    to: 'shop@optimas.co.ke',
    subject: 'Reminder — monthly VAT return due 20th',
    body: [
      'This is a reminder that your monthly VAT return for the previous tax period is due on the 20th.',
      'Log in to iTax to file your return and avoid penalties.',
    ],
    at: NOW - DAY * 3,
    folder: 'inbox',
  },
  {
    id: 5,
    from: 'shop@optimas.co.ke',
    to: 'grace.w@gmail.com',
    subject: 'Re: Quote request — Ekon 500 battery pack',
    body: [
      'Hi Grace,',
      'Yes, the 60V 20Ah pack is in stock at KES 28,500 fitted. We can book you in for Thursday afternoon — just reply with your plate number.',
      'Regards, Optimas Moto Spares',
    ],
    at: NOW - DAY * 1.4,
    folder: 'sent',
  },
]

function timeAgo(at: number) {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })
}

export default function MessagesPage() {
  const toast = useToast()
  const [messages, setMessages] = useState<Message[]>(SEED)
  const [folder, setFolder] = useState<'inbox' | 'sent'>('inbox')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(SEED[0].id)
  const [compose, setCompose] = useState(false)
  const [draft, setDraft] = useState({ to: '', subject: '', body: '' })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return messages
      .filter((m) => m.folder === folder)
      .filter(
        (m) =>
          !q ||
          m.from.toLowerCase().includes(q) ||
          m.subject.toLowerCase().includes(q) ||
          m.body.join(' ').toLowerCase().includes(q),
      )
      .sort((a, b) => b.at - a.at)
  }, [messages, folder, query])

  const open = visible.find((m) => m.id === selected) ?? visible[0]

  const select = (id: number) => setSelected(id)

  const send = () => {
    try {
      if (!draft.to.trim()) throw new Error('Enter at least one recipient.')
      setMessages((prev) => [
        {
          id: Date.now(),
          from: 'shop@optimas.co.ke',
          to: draft.to.trim(),
          subject: draft.subject.trim() || '(no subject)',
          body: draft.body.split('\n').filter(Boolean),
          at: Date.now(),
          folder: 'sent',
        },
        ...prev,
      ])
      setDraft({ to: '', subject: '', body: '' })
      setCompose(false)
      setFolder('sent')
      toast('Message added to Sent', 'ok')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Messages"
        subtitle="Shop inbox — supplier orders, customer enquiries and account notices"
        actions={
          <button className="btn-primary" onClick={() => setCompose(true)}>
            <Pencil size={16} /> Compose
          </button>
        }
      />

      <div className="flex h-[min(70vh,640px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* List pane */}
        <div className="flex w-full shrink-0 flex-col border-r border-slate-200 lg:w-[340px]">
          <div className="space-y-2.5 border-b border-slate-200 p-3">
            <Segmented
              options={{
                inbox: `Inbox (${messages.filter((m) => m.folder === 'inbox').length})`,
                sent: `Sent (${messages.filter((m) => m.folder === 'sent').length})`,
              }}
              value={folder}
              onChange={(v) => {
                setFolder(v)
                setSelected(null)
              }}
            />
            <div className="relative">
              <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input
                className="input !py-2 !pl-9 text-sm"
                placeholder="Search messages…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <Empty>No messages here.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visible.map((m) => {
                  const activeId = open?.id
                  const isActive = m.id === activeId
                  const sender = m.folder === 'inbox' ? m.from.split('<')[0].trim() : m.to
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => select(m.id)}
                        className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${
                          isActive ? 'border-l-[3px] border-[#2f63a8] bg-[#2f63a8]/5 pl-[13px]' : 'border-l-[3px] border-transparent pl-[13px]'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-800">{sender}</span>
                          <span className="shrink-0 text-xs text-slate-400">{timeAgo(m.at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-slate-600">{m.subject}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-400">
                          {m.body[0] ?? ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Reading pane */}
        <div className="hidden min-w-0 flex-1 flex-col lg:flex">
          {!open ? (
            <div className="grid flex-1 place-items-center text-sm text-slate-500">
              <span className="flex items-center gap-2">
                <Inbox size={16} /> Select a message to read
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:hidden"
                  onClick={() => setSelected(null)}
                  aria-label="Back to list"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-bold text-slate-900">{open.subject}</h2>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {open.folder === 'inbox' ? 'From ' : 'To '}
                    {open.folder === 'inbox' ? open.from : open.to}
                  </p>
                </div>
                <Badge tone={open.folder === 'inbox' ? 'blue' : 'slate'}>
                  {open.folder === 'inbox' ? 'Inbox' : 'Sent'}
                </Badge>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                {open.body.map((p, i) => (
                  <p key={i} className="max-w-2xl text-[15px] leading-relaxed text-slate-700">
                    {p}
                  </p>
                ))}
                <p className="pt-2 text-xs text-slate-400">
                  {new Date(open.at).toLocaleString('en-KE', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {compose && (
        <Modal
          title="Compose message"
          onClose={() => setCompose(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setCompose(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={send}>
                <Send size={16} /> Add to Sent
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="msg-to">
                To
              </label>
              <input
                id="msg-to"
                className="input"
                placeholder="recipient@company.co.ke"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="msg-subject">
                Subject
              </label>
              <input
                id="msg-subject"
                className="input"
                placeholder="Subject"
                value={draft.subject}
                onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="msg-body">
                Message
              </label>
              <textarea
                id="msg-body"
                className="input min-h-36 resize-y"
                placeholder="Write your message…"
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              />
            </div>
            <p className="text-xs text-slate-400">
              Stored locally on this device — connect email delivery in Settings to send for real.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
