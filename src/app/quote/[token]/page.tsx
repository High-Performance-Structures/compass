export const dynamic = "force-dynamic"

import type { Metadata } from "next"

import { QuoteLinkForm } from "@/components/rfqs/quote-link-form"
import { getCloudflareContext } from "@/lib/db"
import { updateRfqQuoteLinkById } from "@/lib/domain/operations/store"
import { quoteLinkView, resolveQuoteLink } from "@/lib/rfqs/quote-link-server"

export const metadata: Metadata = {
  title: "Request for quote",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

/** No-login price page from an RFQ email. The token in the URL is the only key. */
export default async function QuoteLinkPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>
}): Promise<React.ReactElement> {
  const { token } = await params
  const { env } = await getCloudflareContext()
  const context = await resolveQuoteLink(env, token, new Date())
  if (!context) {
    return (
      <main className="min-h-screen bg-muted/30 px-4 py-14">
        <div className="mx-auto grid max-w-xl gap-2">
          <h1 className="text-xl font-semibold">This price link isn&apos;t available</h1>
          <p className="text-sm text-muted-foreground">
            It may have expired or been turned off. Reply to the RFQ email with your quote, or ask the sender for a new link.
          </p>
        </div>
      </main>
    )
  }
  await updateRfqQuoteLinkById(context.db, context.link.id, { lastOpenedAt: new Date().toISOString() })
  const view = await quoteLinkView(context)
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <QuoteLinkForm token={token} view={view} />
      </div>
    </main>
  )
}
