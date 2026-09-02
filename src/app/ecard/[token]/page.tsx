export const dynamic = "force-dynamic"

import { and, eq, inArray, isNull } from "drizzle-orm"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { EcardPreview } from "@/components/cards/ecard-preview"
import { getDb } from "@/db"
import { greetingCardRequests } from "@/db/schema"
import { getCloudflareContext } from "@/lib/db"
import { getEcardTemplate } from "@/lib/greeting-cards/templates"

export const metadata: Metadata = {
  title: "A card from High Performance Structures",
  robots: { index: false, follow: false },
}

export default async function EcardPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>
}): Promise<React.ReactElement> {
  const { token } = await params
  if (token.length < 20 || token.length > 100) notFound()
  const { env } = await getCloudflareContext()
  if (!env?.DB) notFound()
  const rows = await getDb(env.DB)
    .select({
      providerCardId: greetingCardRequests.providerCardId,
      recipientFirstName: greetingCardRequests.recipientFirstName,
      message: greetingCardRequests.message,
      wishes: greetingCardRequests.wishes,
      giftAmountCents: greetingCardRequests.giftAmountCents,
      giftClaimUrl: greetingCardRequests.giftClaimUrl,
    })
    .from(greetingCardRequests)
    .where(
      and(
        eq(greetingCardRequests.publicToken, token),
        eq(greetingCardRequests.deliveryMethod, "digital_email"),
        inArray(greetingCardRequests.status, ["submitted", "needs_attention"]),
        isNull(greetingCardRequests.deletedAt),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row) notFound()
  const template = getEcardTemplate(row.providerCardId)
  if (!template) notFound()

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <EcardPreview
          template={template}
          recipientName={row.recipientFirstName}
          message={row.message}
          wishes={row.wishes}
          giftAmountCents={row.giftAmountCents}
          giftClaimUrl={row.giftClaimUrl}
        />
        <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
          This private card was sent by High Performance Structures Inc.
          If you were not expecting it, contact the sender before opening the gift.
        </p>
      </div>
    </main>
  )
}
