import "server-only"

import { and, eq, lte, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { emailMailboxState } from "@/db/schema"

type Db = ReturnType<typeof getDb>

export async function mailboxCooldown(db: Db, mailbox: string, now: string): Promise<string | null> {
  const row = await db.select().from(emailMailboxState)
    .where(eq(emailMailboxState.mailbox, mailbox.toLowerCase())).get()
  return row && row.nextAllowedAt > now ? row.nextAllowedAt : null
}

export async function deferMailbox(db: Db, mailbox: string, retryAt: string): Promise<void> {
  await db.insert(emailMailboxState).values({
    mailbox: mailbox.toLowerCase(), nextAllowedAt: retryAt, leaseExpiresAt: "1970-01-01T00:00:00.000Z",
  }).onConflictDoUpdate({ target: emailMailboxState.mailbox,
    set: { nextAllowedAt: sql`max(${emailMailboxState.nextAllowedAt}, ${retryAt})` },
  }).run()
}

/** Reserve a sending slot across simultaneous cron and user requests. */
export async function claimMailbox(db: Db, mailbox: string, now: string, token: string): Promise<boolean> {
  await db.insert(emailMailboxState).values({ mailbox: mailbox.toLowerCase(), nextAllowedAt: now, leaseExpiresAt: now })
    .onConflictDoNothing().run()
  const rows = await db.update(emailMailboxState).set({ leaseToken: token,
    leaseExpiresAt: new Date(Date.parse(now) + 120_000).toISOString(),
  }).where(and(eq(emailMailboxState.mailbox, mailbox.toLowerCase()),
    lte(emailMailboxState.nextAllowedAt, now), lte(emailMailboxState.leaseExpiresAt, now)))
    .returning({ mailbox: emailMailboxState.mailbox })
  return rows.length === 1
}

export async function releaseMailbox(db: Db, mailbox: string, token: string, now: string, spacingMs = 5_000): Promise<void> {
  const nextSlot = new Date(Date.parse(now) + spacingMs).toISOString()
  await db.update(emailMailboxState).set({ leaseToken: null, leaseExpiresAt: now,
    nextAllowedAt: sql`max(${emailMailboxState.nextAllowedAt}, ${nextSlot})`,
  }).where(and(eq(emailMailboxState.mailbox, mailbox.toLowerCase()), eq(emailMailboxState.leaseToken, token))).run()
}
