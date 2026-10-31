import "server-only"

import type { getDb } from "@/db"
import type { TradeLetter } from "@/db/schema-trade-docs"
import { tradeLetterEventChange } from "@/lib/domain/trade-letters/rules"
import { updateTradeLetter } from "@/lib/domain/trade-letters/store"
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
  const change = tradeLetterEventChange(letter, event, now)
  if (change.kind === "none") {
    return Response.json(change.ignored ? { success: true, ignored: true } : { success: true })
  }
  await updateTradeLetter(db, letter.id, change.values)
  if (change.kind === "sent") return Response.json({ success: true })
  if (change.kind === "closed") {
    await announce(db, letter, change.outcome)
    return Response.json({ success: true })
  }
  // The signature is recorded first; filing the copy in Drive is best effort
  // and the signed letter stays available from Foxit either way.
  try {
    const fileId = await fileSignedTradeLetter({ db, env, letter, now })
    if (fileId) await updateTradeLetter(db, letter.id, { signedDriveFileId: fileId, updatedAt: now })
  } catch (error) {
    console.error("[trade-letters] filing the signed letter failed", error)
  }
  await announce(db, letter, "signed")
  return Response.json({ success: true })
}
