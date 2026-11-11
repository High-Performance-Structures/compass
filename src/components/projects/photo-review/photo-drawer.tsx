"use client"

/**
 * One photo in the record drawer (Photo Review): the photo with previous/next,
 * its caption, type, phase and who can see it, Save, Delete and Open original. "Full
 * screen" opens the shared full-screen viewer; its "Edit details" comes back
 * here. See docs/development/ui-standards.md, "Record drawer".
 */

import * as React from "react"
import Image from "next/image"
import {
  IconArrowsMaximize,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceFloppy,
  IconExternalLink,
  IconPencil,
  IconPhoto,
} from "@tabler/icons-react"

import type { ProjectPhotoLibrary, ProjectPhotoLibraryItem } from "@/app/actions/project-photos"
import { PhotoFullScreenViewer } from "@/components/photos/photo-full-screen-viewer"
import { PhotoDeleteButton } from "@/components/projects/photo-review/photo-delete-button"
import type { PhotoImageRetry } from "@/components/projects/photo-review/use-photo-image-retry"
import { RecordDrawer } from "@/components/record-drawer"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { SourceTag } from "@/components/shared/source-tag"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { photoLinkHref, projectInternalPhotoUrl } from "@/lib/photo-sources"
import { GALLERY_PHOTO_KINDS, NO_PHASE_VALUE, PHOTO_CAPTION_MAX_LENGTH, phaseLabel, sourceLabel, statusLabel } from "@/lib/photos/review"

export type PhotoDetailsInput = {
  /** Blank clears the caption, so the file name shows instead. */
  readonly caption: string
  readonly photoKind: string
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly publicShareable: boolean
  /** The phase value, or NO_PHASE_VALUE. */
  readonly phase: string
}

export function PhotoDrawer({
  previewPhoto,
  filteredPhotos,
  library,
  images,
  developerModeEnabled,
  isPending,
  onClose,
  onShowPhoto,
  onShowAdjacent,
  onSave,
  onDelete,
}: {
  readonly previewPhoto: ProjectPhotoLibraryItem | null
  readonly filteredPhotos: readonly ProjectPhotoLibraryItem[]
  readonly library: ProjectPhotoLibrary
  readonly images: PhotoImageRetry
  readonly developerModeEnabled: boolean
  readonly isPending: boolean
  readonly onClose: () => void
  readonly onShowPhoto: (photoId: string) => void
  readonly onShowAdjacent: (direction: "previous" | "next") => void
  readonly onSave: (photo: ProjectPhotoLibraryItem, input: PhotoDetailsInput) => void
  readonly onDelete: (photo: ProjectPhotoLibraryItem) => void
}): React.ReactElement {
  const [fullScreen, setFullScreen] = React.useState(false)

  return (
    <>
      <RecordDrawer
        open={previewPhoto !== null && !fullScreen}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        eyebrow={
          previewPhoto
            ? `Photo · ${filteredPhotos.findIndex((photo) => photo.id === previewPhoto.id) + 1} of ${filteredPhotos.length}`
            : "Photo"
        }
        title={previewPhoto ? (previewPhoto.caption ?? previewPhoto.fileName) : "Photo"}
        description={
          previewPhoto
            ? `${previewPhoto.photoDate ?? "Capture date unknown"} · ${statusLabel(previewPhoto.reviewStatus)}`
            : undefined
        }
      >
        {previewPhoto ? (
          <PhotoDrawerBody
            key={previewPhoto.id}
            photo={previewPhoto}
            library={library}
            images={images}
            hasNeighbors={filteredPhotos.length > 1}
            developerModeEnabled={developerModeEnabled}
            isPending={isPending}
            onShowAdjacent={onShowAdjacent}
            onFullScreen={() => setFullScreen(true)}
            onSave={(input) => onSave(previewPhoto, input)}
            onDelete={() => onDelete(previewPhoto)}
          />
        ) : null}
      </RecordDrawer>
      <PhotoFullScreenViewer
        photos={filteredPhotos}
        currentId={fullScreen ? (previewPhoto?.id ?? null) : null}
        describe={(photo) => {
          const original = images.imageFor(photo, "original")
          const thumbnail = images.imageFor(photo, "thumbnail")
          return {
            id: photo.id,
            title: photo.caption ?? photo.fileName,
            subtitle: `${photo.photoDate ?? "Capture date unknown"} · ${phaseLabel(photo.schedulePhase)}`,
            alt: photo.caption ?? photo.fileName,
            src: original.imageSrc,
            thumbSrc: thumbnail.imageSrc,
            fallbackLabel: original.resolvedImage.label,
            imageKey: `${photo.id}-${original.retryAttempt}`,
          }
        }}
        onSelect={onShowPhoto}
        onClose={() => {
          setFullScreen(false)
          onClose()
        }}
        onImageError={images.markImageFailed}
        arrowKeys={false}
        actions={
          <Button type="button" variant="outline" onClick={() => setFullScreen(false)}>
            <IconPencil className="size-4" />
            Edit details
          </Button>
        }
      />
    </>
  )
}

function PhotoDrawerBody({
  photo,
  library,
  images,
  hasNeighbors,
  developerModeEnabled,
  isPending,
  onShowAdjacent,
  onFullScreen,
  onSave,
  onDelete,
}: {
  readonly photo: ProjectPhotoLibraryItem
  readonly library: ProjectPhotoLibrary
  readonly images: PhotoImageRetry
  readonly hasNeighbors: boolean
  readonly developerModeEnabled: boolean
  readonly isPending: boolean
  readonly onShowAdjacent: (direction: "previous" | "next") => void
  readonly onFullScreen: () => void
  readonly onSave: (input: PhotoDetailsInput) => void
  readonly onDelete: () => void
}): React.ReactElement {
  const [caption, setCaption] = React.useState(photo.caption ?? "")
  const [photoKind, setPhotoKind] = React.useState(photo.photoKind)
  const [ownerVisible, setOwnerVisible] = React.useState(photo.ownerVisible)
  const [subVendorVisible, setSubVendorVisible] = React.useState(photo.subVendorVisible)
  const [publicShareable, setPublicShareable] = React.useState(photo.publicShareable)
  const [phase, setPhase] = React.useState(photo.schedulePhase || NO_PHASE_VALUE)
  const { resolvedImage, retryAttempt, imageSrc } = images.imageFor(photo, "original")
  const href = photoLinkHref(projectInternalPhotoUrl(library.project.id, photo.id))

  return (
    <div className="grid gap-5">
      <div className="relative h-[min(52vh,420px)] overflow-hidden rounded-lg bg-muted/40">
        {imageSrc ? (
          <Image
            key={`${photo.id}-${retryAttempt}`}
            src={imageSrc}
            alt={photo.caption ?? photo.fileName}
            fill
            sizes="720px"
            unoptimized
            className="object-contain"
            onError={() => images.markImageFailed(photo.id)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <IconPhoto className="size-12 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">{resolvedImage.label}</p>
          </div>
        )}
        {hasNeighbors ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => onShowAdjacent("previous")}
              aria-label="Show previous photo"
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md"
            >
              <IconChevronLeft className="size-5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => onShowAdjacent("next")}
              aria-label="Show next photo"
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md"
            >
              <IconChevronRight className="size-5" />
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onFullScreen}
          className="absolute bottom-3 right-3 z-10 bg-background/90 shadow-md"
        >
          <IconArrowsMaximize className="size-4" />
          Full screen
        </Button>
      </div>

      {photo.sourceSystem === "buildertrend" || developerModeEnabled ? (
        <div className="flex flex-wrap gap-1">
          {photo.sourceSystem === "buildertrend" ? (
            <SourceTag source="buildertrend" />
          ) : (
            <Badge variant="outline">{sourceLabel(photo.sourceSystem)}</Badge>
          )}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={`photo-caption-${photo.id}`}>Caption</Label>
        <Textarea
          id={`photo-caption-${photo.id}`}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          maxLength={PHOTO_CAPTION_MAX_LENGTH}
          disabled={isPending}
          placeholder={`What this photo shows. Without one, the file name (${photo.fileName}) shows.`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Phase</Label>
          <SearchableCombobox
            ariaLabel="Phase"
            options={[
              { value: NO_PHASE_VALUE, label: "No phase" },
              ...library.phases.map((option) => ({ value: option.value, label: option.label })),
            ]}
            value={phase}
            onValueChange={setPhase}
            disabled={isPending}
            placeholder="No phase"
            searchPlaceholder="Search phases..."
            emptyMessage="No matching phases."
            groupHeading="Phases"
          />
          {photo.schedulePhase.length > 0 && photo.schedulePhaseReason ? (
            <p className="text-xs text-muted-foreground">{photo.schedulePhaseReason}</p>
          ) : null}
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor={`photo-kind-${photo.id}`}>Type</Label>
          <Select value={photoKind} onValueChange={setPhotoKind} disabled={isPending}>
            <SelectTrigger id={`photo-kind-${photo.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GALLERY_PHOTO_KINDS.map((kind) => (
                <SelectItem key={kind.value} value={kind.value}>
                  {kind.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Selection photos are in Selections.</p>
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Who can see it</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={ownerVisible} onChange={(event) => setOwnerVisible(event.target.checked)} />
            Owner
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={subVendorVisible}
              onChange={(event) => setSubVendorVisible(event.target.checked)}
            />
            Subs/vendors
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={publicShareable}
              onChange={(event) => setPublicShareable(event.target.checked)}
            />
            Public
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Leave all three off to keep the photo internal. Saving approves the photo.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <PhotoDeleteButton selectedCount={1} disabled={isPending} onConfirm={onDelete} />
        <div className="flex flex-wrap items-center gap-2">
          {href ? (
            <Button asChild variant="ghost">
              <a href={href} target="_blank" rel="noreferrer">
                <IconExternalLink className="size-4" />
                Open original
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={isPending}
            onClick={() => onSave({ caption, photoKind, ownerVisible, subVendorVisible, publicShareable, phase })}
          >
            <IconDeviceFloppy className="size-4" />
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
