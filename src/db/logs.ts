import { db } from './db'
import type { LogKind } from './types'

/**
 * Append an entry to the audit log. Never throws — logging must not break the
 * operation it is recording.
 */
export async function logActivity(
  kind: LogKind,
  action: string,
  opts?: { detail?: string; userId?: number; userName?: string },
): Promise<void> {
  try {
    await db.logs.add({
      at: Date.now(),
      kind,
      action,
      detail: opts?.detail,
      userId: opts?.userId,
      userName: opts?.userName,
    })
  } catch {
    /* ignore */
  }
}

/** Resolve a user name for log entries when only an id is known. */
export async function userName(userId?: number): Promise<string | undefined> {
  if (userId == null) return undefined
  const u = await db.users.get(userId)
  return u?.name
}
