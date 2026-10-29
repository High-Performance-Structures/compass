import "server-only"

import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { tradeLetters, type TradeLetter } from "@/db/schema-trade-docs"
import { announceEsignOutcome } from "@/lib/esign/announce"
import { fileSignedTradeLetter } from "@/lib/trade-letters/server"

type Db = ReturnType<typeof getDb>

function announce(db: Db, letter: TradeLetter, outcome: "signed" | "declined" | "cancelled"): Promise<void> {
  return announceEsignOutcome({
    db,
    projectId: letter.projectId,
    kind: "trade_letter",
    outcome,
    recordId: letter.id,
    number: letter.letterNumber,
    title: letter.vendorName,
    changeOrderId: null,
    estimateId: letter.estimateId,
    sentBy: letter.createdBy,
  })
}

/** Foxit's envelope events for a letter to a trade. Repeats are ignored. */
export async function handleTradeLetterEvent(input: { readonly db: Db; readonly env: CloudflareEnv; readonly letter: TradeLetter; readonly event: string }): Promise<Response> {
  const { db, env, letter, event } = input
  const now = new Date().toISOString()
  if (event === "folder_sent") {
    if (letter.status === "draft" || letter.status === "preparing") {
      await db
        .update(tradeLetters)
        .set({ status: "sent", sentAt: now, foxitEmbeddedSessionUrl: null, updatedAt: now })
        .where(eq(tradeLetters.id, letter.id))
        .run()
    }
    return Response.json({ success: true })
  }
  if (event === "folder_cancelled" || event === "folder_declined") {
    const outcome = event === "folder_declined" ? "declined" : "cancelled"
    if (letter.status === outcome || letter.status === "signed") return Response.json({ success: true })
    await db.update(tradeLetters).set({ status: outcome, updatedAt: now }).where(eq(tradeLetters.id, letter.id)).run()
    await announce(db, letter, outcome)
    return Response.json({ success: true })
  }
  if (event !== "folder_executed" || letter.status === "signed") {
    return Response.json({ success: true, ignored: true })
  }
  await db.update(tradeLetters).set({ status: "signed", signedAt: now, updatedAt: now }).where(eq(tradeLetters.id, letter.id)).run()
  // The signature is recorded first; filing the copy in Drive is best effort
  // and the signed letter stays available from Foxit either way.
  try {
    const fileId = await fileSignedTradeLetter({ db, env, letter, now })
    if (fileId) {
      await db.update(tradeLetters).set({ signedDriveFileId: fileId, updatedAt: now }).where(eq(tradeLetters.id, letter.id)).run()
    }
  } catch (error) {
    console.error("[trade-letters] filing the signed letter failed", error)
  }
  await announce(db, letter, "signed")
  return Response.json({ success: true })
}
