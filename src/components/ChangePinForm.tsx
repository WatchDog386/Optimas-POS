import { useState } from 'react'
import { db } from '../db/db'
import { logActivity } from '../db/logs'
import { PIN_MAX, PIN_MIN, useSession } from '../session'
import { hashPin, verifyPin, weakPinReason } from '../lib/pinHash'
import { pushOwnPin } from '../lib/api'
import { errorText, useToast } from './ui'

/** Three-field "change my PIN" form, shared by Settings → Security and the Profile page. */
export default function ChangePinForm() {
  const { user } = useSession()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  const change = async () => {
    try {
      if (!user) throw new Error('No signed-in user')
      if (!verifyPin(current, user.pinHash)) throw new Error('Current PIN is wrong')
      const weak = weakPinReason(next)
      if (weak) throw new Error(weak)
      if (next === current) throw new Error('Pick a PIN you are not using right now')
      if (next !== confirmPin) throw new Error('New PIN and confirmation do not match')
      const pinHash = hashPin(next)
      await db.users.update(user.id!, { pinHash, mustChangePin: undefined })
      void pushOwnPin(current, pinHash)
      await logActivity('user', `PIN changed for ${user.name}`, { userId: user.id, userName: user.name })
      toast('PIN changed')
      setCurrent('')
      setNext('')
      setConfirmPin('')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  if (!user) return null

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Current PIN</label>
          <input
            className="input font-mono tracking-[0.4em]"
            type="password"
            inputMode="numeric"
            maxLength={PIN_MAX}
            value={current}
            onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label className="label">{`New PIN (${PIN_MIN}–${PIN_MAX} digits)`}</label>
          <input
            className="input font-mono tracking-[0.4em]"
            type="password"
            inputMode="numeric"
            maxLength={PIN_MAX}
            value={next}
            onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label className="label">Repeat new PIN</label>
          <input
            className="input font-mono tracking-[0.4em]"
            type="password"
            inputMode="numeric"
            maxLength={PIN_MAX}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={change} disabled={!current || !next || !confirmPin}>
          Change PIN
        </button>
      </div>
    </>
  )
}
