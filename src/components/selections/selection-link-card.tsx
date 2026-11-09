/*
 * A supplier product link as a small preview card: the page's image, site,
 * title and listed price when the page gave them, or just the address.
 * Opens the supplier's page in a new tab.
 */
import * as React from "react"
import { IconExternalLink, IconTrash } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { formatCents } from "@/lib/format"
import type { SelectionLinkView } from "@/lib/domain/selections/choices-read"

export function linkSiteName(link: Pick<SelectionLinkView, "siteName" | "url">): string {
  if (link.siteName) return link.siteName
  try {
    return new URL(link.url).hostname.replace(/^www\./, "")
  } catch {
    return link.url
  }
}

export function SelectionLinkCard({
  link,
  addedByOwner,
  onRemove,
}: {
  readonly link: SelectionLinkView
  /** Shows "Added by owner" on the staff side. */
  readonly addedByOwner?: boolean
  readonly onRemove?: () => void
}): React.ReactElement {
  const site = linkSiteName(link)
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
      {link.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a supplier's own image, shown as it is on their page
        <img src={link.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-8 flex-none rounded object-cover" />
      ) : (
        <span aria-hidden className="size-8 flex-none rounded bg-muted" />
      )}
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {addedByOwner && <span className="text-muted-foreground">Added by owner · </span>}
        <span className="text-muted-foreground">{site}</span>
        {link.title && <> · {link.title}</>}
        {link.priceCents !== null && <> · {formatCents(link.priceCents)}</>}
        <IconExternalLink className="ml-1 inline size-3 align-[-1px] text-muted-foreground" aria-hidden />
        <span className="sr-only"> (opens the supplier&apos;s page)</span>
      </a>
      {onRemove && (
        <Button type="button" variant="ghost" size="icon" className="size-7 flex-none" aria-label={`Remove link to ${site}`} onClick={onRemove}>
          <IconTrash className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
