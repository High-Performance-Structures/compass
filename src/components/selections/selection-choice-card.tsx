"use client"

/*
 * One choice in the staff detail panel: drag handle, first photo (or the
 * supplier page's image), title, supplier price, supplier, lead time, owner
 * price and over/under the allowance, a lead-time warning when this choice
 * must be ordered soon (or may arrive late), supplier link cards, the
 * follow-ups this choice opens, and the owner's-pick highlight. Rows are reordered with
 * the shared line-order control (rows inside one selection).
 */
import * as React from "react"
import { IconDotsVertical } from "@tabler/icons-react"

import { ReorderHandle, SortableRow } from "@/components/ui/sortable-rows"
import { SelectionLinkCard } from "@/components/selections/selection-link-card"
import { SourceTag } from "@/components/shared/source-tag"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { allowanceDeltaCents, pickedByLabel } from "@/lib/domain/selections/choice-rules"
import type { SelectionChoiceView } from "@/lib/domain/selections/choices-read"
import { staffLeadTimeNote, type SelectionLeadTimeWarning } from "@/lib/domain/selections/lead-time-rules"
import { formatCents } from "@/lib/format"
import { projectInternalPhotoUrl } from "@/lib/photo-sources"
import { cn } from "@/lib/utils"

export function OverUnder({ deltaCents }: { readonly deltaCents: number | null }): React.ReactElement | null {
  if (deltaCents === null) return null
  if (deltaCents === 0) return <span className="text-muted-foreground">on allowance</span>
  return (
    <span className={cn("font-semibold", deltaCents > 0 ? "text-destructive" : "text-primary")}>
      {deltaCents > 0 ? "+" : "−"}
      {formatCents(Math.abs(deltaCents))}
    </span>
  )
}

export function SelectionChoiceCard({
  projectId,
  choice,
  index,
  allowanceCents,
  leadTimeWarning,
  followUpNames,
  busy,
  onEdit,
  onTogglePick,
  onAddLink,
  onAttachPhotos,
  onFollowUps,
  onRemoveLink,
  onDelete,
}: {
  readonly projectId: string
  readonly choice: SelectionChoiceView
  readonly index: number
  readonly allowanceCents: number | null
  /** Set on the one choice whose lead time puts the selection at risk. */
  readonly leadTimeWarning: SelectionLeadTimeWarning | null
  readonly followUpNames: readonly string[]
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onTogglePick: () => void
  readonly onAddLink: () => void
  readonly onAttachPhotos: () => void
  readonly onFollowUps: () => void
  readonly onRemoveLink: (linkId: string) => void
  readonly onDelete: () => void
}): React.ReactElement {
  const photo = choice.photos[0] ?? null
  const linkImage = choice.links.find((link) => link.imageUrl)?.imageUrl ?? null
  const supplier = choice.vendorName ?? choice.supplierName
  const facts = [
    choice.priceCents !== null ? formatCents(choice.priceCents) : "Not priced",
    supplier,
    choice.leadTimeDays !== null ? `${choice.leadTimeDays} day${choice.leadTimeDays === 1 ? "" : "s"}` : null,
  ].filter((value): value is string => Boolean(value))

  return (
    <SortableRow
      id={choice.id}
      index={index}
      className={cn("flex gap-2 rounded-lg border p-2", choice.chosen && "border-2 border-primary bg-primary/5")}
    >
      <ReorderHandle label={choice.title} />
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- project photo served by the photos route
        <img src={projectInternalPhotoUrl(projectId, photo.photoId)} alt={photo.fileName} loading="lazy" className="size-20 flex-none rounded-md object-cover" />
      ) : linkImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- the supplier page's own image
        <img src={linkImage} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-20 flex-none rounded-md object-cover" />
      ) : (
        <span aria-hidden className="size-20 flex-none rounded-md bg-muted" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words font-semibold">
            {choice.title}
            {choice.sourceSystem === "buildertrend" && <SourceTag source="buildertrend" className="ml-1" />}
          </span>
          <div className="flex flex-none items-center gap-1">
            {choice.chosen && <Badge>Owner&apos;s pick</Badge>}
            {choice.suggestedByOwner && (
              <Badge variant="outline" title={choice.suggestedByName ? `Suggested by ${choice.suggestedByName}` : undefined}>
                Suggested by owner
              </Badge>
            )}
            {choice.status !== "proposed" && choice.status !== "available" && <Badge variant="outline">{choice.status === "unavailable" ? "Unavailable" : "Declined"}</Badge>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${choice.title}`} disabled={busy}>
                  <IconDotsVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
                <DropdownMenuItem onSelect={onTogglePick}>{choice.chosen ? "Clear owner's pick" : "Mark as owner's pick"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={onAddLink}>Paste product link</DropdownMenuItem>
                <DropdownMenuItem onSelect={onAttachPhotos}>Attach photos</DropdownMenuItem>
                <DropdownMenuItem onSelect={onFollowUps}>Follow-up selections</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={onDelete}>Delete choice</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <span className="text-sm">{facts.join(" · ")}</span>
        <span className="text-sm">
          Owner price{" "}
          {choice.ownerPricingPending ? (
            <span className="font-medium text-warning">pending staff pricing (Edit to set it)</span>
          ) : choice.ownerPriceCents !== null ? (
            formatCents(choice.ownerPriceCents)
          ) : (
            <span className="text-muted-foreground">not set</span>
          )}
          {choice.ownerPriceCents !== null && allowanceCents !== null && (
            <> · <OverUnder deltaCents={allowanceDeltaCents(choice.ownerPriceCents, allowanceCents)} /></>
          )}
        </span>
        {leadTimeWarning && (
          <p
            role="note"
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium",
              leadTimeWarning.level === "late" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-warning/30 bg-warning/10 text-warning",
            )}
          >
            {staffLeadTimeNote(leadTimeWarning)}
          </p>
        )}
        {choice.chosen && choice.chosenAt && (
          <p className="text-xs text-muted-foreground">
            {pickedByLabel(choice)}
            {choice.chosenNote && <> · &ldquo;{choice.chosenNote}&rdquo;</>}
          </p>
        )}
        {choice.description && <p className="line-clamp-2 text-xs text-muted-foreground">{choice.description}</p>}
        {choice.links.map((link) => (
          <SelectionLinkCard key={link.id} link={link} addedByOwner={link.addedByAudience === "owner"} onRemove={() => onRemoveLink(link.id)} />
        ))}
        {choice.photos.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {choice.photos.slice(1).map((extra) => (
              // eslint-disable-next-line @next/next/no-img-element -- project photo served by the photos route
              <img key={extra.linkId} src={projectInternalPhotoUrl(projectId, extra.photoId)} alt={extra.fileName} loading="lazy" className="size-10 rounded object-cover" />
            ))}
          </div>
        )}
        {followUpNames.length > 0 && (
          <span className="text-xs text-muted-foreground">Opens: {followUpNames.join(", ")}</span>
        )}
      </div>
    </SortableRow>
  )
}
