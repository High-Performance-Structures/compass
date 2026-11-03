"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconCheck,
  IconCompass,
  IconCompassFilled,
  IconExternalLink,
  IconHourglass,
  IconPhoto,
  IconX,
} from "@tabler/icons-react"

import type {
  ProjectPhotoLibrary,
  ProjectPhotoLibraryItem,
} from "@/app/actions/project-photos"
import { Badge } from "@/components/ui/badge"
import { SearchableCombobox } from "@/components/searchable-combobox"
import type { PhotoImageRetry } from "@/components/projects/photo-review/use-photo-image-retry"
import {
  photoLinkHref,
  projectInternalPhotoUrl,
} from "@/lib/photo-sources"
import {
  isInternalOnly,
  kindLabel,
  NO_PHASE_VALUE,
  phaseLabel,
  sourceInitial,
  sourceLabel,
  statusLabel,
} from "@/lib/photos/review"

function reviewStatusIcon(value: string): React.ReactElement {
  switch (value) {
    case "approved":
      return <IconCheck className="size-3.5" />
    case "rejected":
      return <IconX className="size-3.5" />
    default:
      return <IconHourglass className="size-3.5" />
  }
}

/** One photo tile: preview button, select toggle, phase picker and link. */
export function PhotoReviewCard({
  photo,
  library,
  selected,
  images,
  developerModeEnabled,
  isPending,
  onOpenPreview,
  onToggle,
  onChangePhase,
}: {
  readonly photo: ProjectPhotoLibraryItem
  readonly library: ProjectPhotoLibrary
  readonly selected: boolean
  readonly images: PhotoImageRetry
  readonly developerModeEnabled: boolean
  readonly isPending: boolean
  readonly onOpenPreview: () => void
  readonly onToggle: (event: React.MouseEvent) => void
  readonly onChangePhase: (phase: string) => void
}): React.ReactElement {
  const internalUrl = projectInternalPhotoUrl(
    library.project.id,
    photo.id
  )
  const href = photoLinkHref(internalUrl)
  const { resolvedImage, retryAttempt, imageSrc } = images.imageFor(photo)
  const sourceName = sourceLabel(photo.sourceSystem)

  return (
    <article
      className={`relative overflow-hidden rounded-md border bg-background ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpenPreview}
        className="block w-full text-left"
        aria-label={`Open larger preview for ${photo.caption ?? photo.fileName}`}
      >
        <div className="relative aspect-[4/3] bg-muted">
          {imageSrc ? (
            <Image
              key={`${photo.id}-${retryAttempt}`}
              src={imageSrc}
              alt={photo.caption ?? photo.fileName}
              fill
              sizes="(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 50vw"
              unoptimized
              className="object-cover"
              onError={() => images.markImageFailed(photo.id)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
              <IconPhoto className="size-8 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                {resolvedImage.label}
              </span>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
            {photo.photoDate ?? "Capture date unknown"}
          </span>
          <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
            {phaseLabel(photo.schedulePhase)}
          </span>
        </div>
        <div className="space-y-2 p-2">
          <p className="line-clamp-2 min-h-10 text-xs font-medium">
            {photo.caption ?? photo.fileName}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <span
              className={`flex size-5 items-center justify-center rounded border text-muted-foreground ${
                photo.reviewStatus === "approved"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : photo.reviewStatus === "rejected"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-border bg-muted/40"
              }`}
              title={`Review status: ${statusLabel(photo.reviewStatus)}`}
              aria-label={`Review status: ${statusLabel(photo.reviewStatus)}`}
            >
              {reviewStatusIcon(photo.reviewStatus)}
            </span>
            <Badge variant="outline">{kindLabel(photo.photoKind)}</Badge>
          </div>
          <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
            {isInternalOnly(photo) && <span>Internal</span>}
            {photo.ownerVisible && <span>Owner</span>}
            {photo.subVendorVisible && <span>Subs/vendors</span>}
            {photo.publicShareable && <span>Public</span>}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={`${selected ? "Deselect" : "Select"} ${photo.caption ?? photo.fileName}`}
        title={`${selected ? "Deselect" : "Select"} photo`}
        className={`absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded border shadow-sm backdrop-blur transition ${
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background/90 text-muted-foreground hover:bg-background hover:text-foreground"
        }`}
      >
        {selected ? (
          <IconCompassFilled className="size-4" />
        ) : (
          <IconCompass className="size-4" />
        )}
      </button>
      <div className="border-t px-2 py-1.5">
        <label className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Phase</span>
          <SearchableCombobox
            ariaLabel={`Phase for ${photo.caption ?? photo.fileName}`}
            options={[
              { value: NO_PHASE_VALUE, label: "No phase" },
              ...library.phases.map((phase) => ({
                value: phase.value,
                label: phase.label,
              })),
            ]}
            value={photo.schedulePhase || NO_PHASE_VALUE}
            onValueChange={onChangePhase}
            disabled={isPending}
            placeholder="No phase"
            searchPlaceholder="Search phases..."
            emptyMessage="No matching phases."
            groupHeading="Phases"
            className="h-7 min-w-0 flex-1 px-1.5 text-xs"
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <IconExternalLink className="size-3" />
            Open
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">
            No link
          </span>
        )}
        {developerModeEnabled && (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded border border-border/70 bg-muted/40 text-xs font-semibold text-muted-foreground"
            title={`Source: ${sourceName}`}
            aria-label={`Source: ${sourceName}`}
          >
            {sourceInitial(photo.sourceSystem)}
          </span>
        )}
      </div>
    </article>
  )
}
