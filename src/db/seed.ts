import { db } from './db'
import { hashPin } from '../lib/pinHash'
import { logActivity } from './logs'

/** True until the first owner account exists — the till then shows the setup screen. */
export async function needsSetup(): Promise<boolean> {
  const owners = await db.users.where('role').equals('owner').toArray()
  return !owners.some((u) => u.active)
}

/**
 * First-run setup: create the owner account. Only allowed while the till has no
 * active owner, so it can't be used to take over a configured till.
 */
export async function createOwner(name: string, pin: string): Promise<number> {
  return db.transaction('rw', db.users, db.logs, async () => {
    if (!(await needsSetup())) throw new Error('This till already has an owner account')
    const id = (await db.users.add({ name: name.trim(), pinHash: hashPin(pin), role: 'owner', active: true })) as number
    await logActivity('user', `Owner account created: ${name.trim()}`, { userId: id, userName: name.trim() })
    return id
  })
}
