"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { turnOffRfqQuoteLinks, type RfqQuoteLinkItem } from "@/app/actions/project-rfq-email"
import { Button } from "@/components/ui/button"

function when(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** Price links sent for one RFQ: whether they still work, opened, answered; and Turn off. */
export function ProjectRfqQuoteLinks({
  projectId,
  rfqId,
  links,
}: {
  readonly projectId: string
  readonly rfqId: string
  readonly links: readonly RfqQuoteLinkItem[]
}): React.ReactElement | null {
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  if (links.length === 0) return null
  const live = links.filter((link) => link.live)

  function turnOff(): void {
    startTransition(async () => {
      const result = await turnOffRfqQuoteLinks(projectId, rfqId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.count ? "Price link turned off." : "No working price links to turn off.")
      setConfirming(false)
      router.refresh()
    })
  }

  return (
    <section className="mt-3 border-t pt-3">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Price links</h3>
      <div className="mt-2 space-y-1">
        {links.map((link) => (
          <div key={link.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
            <span>{link.recipientEmail}</span>
            <span className="text-xs text-muted-foreground">
              {link.live ? `Works until ${when(link.expiresAt)}` : "Off"}
              {link.lastOpenedAt ? ` · opened ${when(link.lastOpenedAt)}` : " · not opened"}
              {link.submittedAt ? ` · answered ${when(link.submittedAt)}` : ""}
            </span>
          </div>
        ))}
      </div>
      {live.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-xs">The vendor won&apos;t be able to enter prices online. They can still reply by email.</span>
              <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={turnOff}>Turn off</Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>Keep it</Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>Turn off price link</Button>
          )}
        </div>
      )}
    </section>
  )
}
