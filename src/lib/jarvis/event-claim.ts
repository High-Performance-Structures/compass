import type { SQL } from "drizzle-orm"

const CLAIM_RETRY_MILLISECONDS = 5 * 60 * 1000

type EventClaimExecution = (input: Readonly<{
  eventId: string
  claimToken: string
  claimedAt: string
  staleClaimAt: string
  eventTypeFilter: SQL<unknown> | undefined
}>) => Promise<boolean>

export async function claimJarvisEvent(
  executeClaim: EventClaimExecution,
  eventId: string,
  eventTypeFilter?: SQL<unknown>,
): Promise<Readonly<{ claimToken: string; claimedAt: string }> | null> {
  const claimNow = new Date()
  const claimNowIso = claimNow.toISOString()
  const staleClaimIso = new Date(
    claimNow.getTime() - CLAIM_RETRY_MILLISECONDS,
  ).toISOString()
  const claimToken = crypto.randomUUID()
  const claimed = await executeClaim({
    eventId,
    claimToken,
    claimedAt: claimNowIso,
    staleClaimAt: staleClaimIso,
    eventTypeFilter,
  })
  return claimed ? { claimToken, claimedAt: claimNowIso } : null
}
