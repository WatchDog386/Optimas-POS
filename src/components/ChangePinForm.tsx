import { useState } from 'react'
import { db } from '../db/db'
import { logActivity } from '../db/logs'
import { PIN_LENGTH, useSession } from '../session'
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
      if (current !== user.pin) throw new Error('Current PIN is wrong')
      if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(next)) throw new Error(`New PIN must be ${PIN_LENGTH} digits`)
      if (next === user.pin) throw new Error('Pick a PIN you are not using right now')
      if (next !== confirmPin) throw new Error('New PIN and confirmation do not match')
      const others = await db.users.where('pin').equals(next).toArray()
      if (others.some((x) => x.id !== user.id)) throw new Error('That PIN is already used by someone else')
      await db.users.update(user.id!, { pin: next })
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
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            value={current}
            onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label className="label">{`New PIN (${PIN_LENGTH} digits)`}</label>
          <input
            className="input font-mono tracking-[0.4em]"
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label className="label">Repeat new PIN</label>
          <input
            className="input font-mono tracking-[0.4em]"
            inputMode="numeric"
            maxLength={PIN_LENGTH}
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
