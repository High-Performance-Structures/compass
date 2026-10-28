export const dynamic = "force-dynamic"

import { eq } from "drizzle-orm"
import type { Metadata } from "next"

import { VendorDocsLinkForm } from "@/components/trade-docs/vendor-docs-link-form"
import { vendorTradeDocLinks } from "@/db/schema-trade-docs"
import { getCloudflareContext } from "@/lib/db"
import { TRADE_DOC_LINK_UPLOAD_LIMIT } from "@/lib/trade-docs/vendor-link"
import { resolveTradeDocLink, tradeDocLinkView } from "@/lib/trade-docs/vendor-link-server"

export const metadata: Metadata = {
  title: "Send your documents",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

/** No-login page from a trade docs request email. The token in the URL is the only key. */
export default async function VendorDocsLinkPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>
}): Promise<React.ReactElement> {
  const { token } = await params
  const { env } = await getCloudflareContext()
  const context = await resolveTradeDocLink(env, token, new Date())
  if (!context) {
    return (
      <main className="min-h-screen bg-muted/30 px-4 py-14">
        <div className="mx-auto grid max-w-xl gap-2">
          <h1 className="text-xl font-semibold">This link isn&apos;t available</h1>
          <p className="text-sm text-muted-foreground">
            It may have expired or been turned off. Reply to the email with your documents attached, or ask the sender for a new link.
          </p>
        </div>
      </main>
    )
  }
  await context.db.update(vendorTradeDocLinks).set({ lastOpenedAt: new Date().toISOString() }).where(eq(vendorTradeDocLinks.id, context.link.id))
  const view = await tradeDocLinkView(context, TRADE_DOC_LINK_UPLOAD_LIMIT)
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <VendorDocsLinkForm token={token} view={view} />
      </div>
    </main>
  )
}
