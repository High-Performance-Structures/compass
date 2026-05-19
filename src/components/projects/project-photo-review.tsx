"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import {
  IconArrowLeft,
  IconExternalLink,
  IconPhoto,
  IconUsers,
} from "@tabler/icons-react"

import {
  updateProjectPhotoPermissions,
  type ProjectPhotoLibrary,
  type ProjectPhotoLibraryItem,
} from "@/app/actions/project-photos"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type VisibilityFilter =
  | "all"
  | "internal"
  | "owner"
  | "subs_vendors"
  | "public"
  | "needs_review"
  | "approved"

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function kindLabel(value: string): string {
  return statusLabel(value)
}

function sourceLabel(value: string): string {
  switch (value) {
    case "buildertrend":
      return "Buildertrend"
    case "google_drive":
      return "Google Drive"
    case "telegram":
      return "Telegram"
    case "mobile":
      return "Mobile"
    default:
      return "Compass"
  }
}

function projectLabel(library: ProjectPhotoLibrary): string {
  return library.project.projectNumber ?? library.project.name
}

function browserHref(value: string | null): string | null {
  if (value === null) return null
  if (value.startsWith("https://") || value.startsWith("http://")) return value
  if (value.startsWith("/owner-update-photos/")) return value
  if (value.startsWith("/project-photo-previews/")) return value
  return null
}

function isInternalOnly(photo: ProjectPhotoLibraryItem): boolean {
  return (
    !photo.ownerVisible &&
    !photo.subVendorVisible &&
    !photo.publicShareable
  )
}

function matchesVisibility(
  photo: ProjectPhotoLibraryItem,
  filter: VisibilityFilter
): boolean {
  switch (filter) {
    case "internal":
      return isInternalOnly(photo)
    case "owner":
      return photo.ownerVisible
    case "subs_vendors":
      return photo.subVendorVisible
    case "public":
      return photo.publicShareable
    case "needs_review":
      return photo.reviewStatus === "needs_review"
    case "approved":
      return photo.reviewStatus === "approved"
    case "all":
      return true
  }
}

function visibilityFilterValue(value: string): VisibilityFilter {
  switch (value) {
    case "internal":
    case "owner":
    case "subs_vendors":
    case "public":
    case "needs_review":
    case "approved":
      return value
    default:
      return "all"
  }
}

function nextSelectedIds(
  current: readonly string[],
  filteredPhotos: readonly ProjectPhotoLibraryItem[],
  photoId: string,
  event: React.MouseEvent,
  lastSelectedId: string | null
): readonly string[] {
  const next = new Set(current)

  if (event.shiftKey && lastSelectedId !== null) {
    const currentIndex = filteredPhotos.findIndex((photo) => photo.id === photoId)
    const lastIndex = filteredPhotos.findIndex(
      (photo) => photo.id === lastSelectedId
    )

    if (currentIndex >= 0 && lastIndex >= 0) {
      const start = Math.min(currentIndex, lastIndex)
      const end = Math.max(currentIndex, lastIndex)
      for (const photo of filteredPhotos.slice(start, end + 1)) {
        next.add(photo.id)
      }
      return [...next]
    }
  }

  if (event.metaKey || event.ctrlKey) {
    if (next.has(photoId)) {
      next.delete(photoId)
    } else {
      next.add(photoId)
    }
    return [...next]
  }

  if (next.has(photoId)) {
    next.delete(photoId)
  } else {
    next.add(photoId)
  }

  return [...next]
}

export function ProjectPhotoReview({
  library,
}: {
  readonly library: ProjectPhotoLibrary
}): React.ReactElement {
  const [photos, setPhotos] =
    React.useState<readonly ProjectPhotoLibraryItem[]>(library.photos)
  const [dateFilter, setDateFilter] = React.useState("all")
  const [visibilityFilter, setVisibilityFilter] =
    React.useState<VisibilityFilter>("all")
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([])
  const [lastSelectedId, setLastSelectedId] = React.useState<string | null>(null)
  const [reviewStatus, setReviewStatus] = React.useState("needs_review")
  const [photoKind, setPhotoKind] = React.useState("progress")
  const [ownerVisible, setOwnerVisible] = React.useState(false)
  const [subVendorVisible, setSubVendorVisible] = React.useState(false)
  const [publicShareable, setPublicShareable] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const dates = React.useMemo(
    () => [...new Set(photos.map((photo) => photo.photoDate))].sort(),
    [photos]
  )
  const filteredPhotos = React.useMemo(
    () =>
      photos.filter(
        (photo) =>
          (dateFilter === "all" || photo.photoDate === dateFilter) &&
          matchesVisibility(photo, visibilityFilter)
      ),
    [dateFilter, photos, visibilityFilter]
  )

  const counts = React.useMemo(
    () => ({
      total: photos.length,
      needsReview: photos.filter(
        (photo) => photo.reviewStatus === "needs_review"
      ).length,
      owner: photos.filter((photo) => photo.ownerVisible).length,
      subVendor: photos.filter((photo) => photo.subVendorVisible).length,
      internal: photos.filter(isInternalOnly).length,
    }),
    [photos]
  )

  function togglePhoto(photoId: string, event: React.MouseEvent): void {
    setSelectedIds((current) =>
      nextSelectedIds(current, filteredPhotos, photoId, event, lastSelectedId)
    )
    setLastSelectedId(photoId)
  }

  function selectFiltered(): void {
    setSelectedIds(filteredPhotos.map((photo) => photo.id))
    setLastSelectedId(filteredPhotos[0]?.id ?? null)
  }

  function clearSelection(): void {
    setSelectedIds([])
    setLastSelectedId(null)
  }

  function applyPermissions(): void {
    const photoIds = selectedIds
    const nextReviewStatus = reviewStatus
    const nextPhotoKind = photoKind
    const nextOwnerVisible = ownerVisible
    const nextSubVendorVisible = subVendorVisible
    const nextPublicShareable = publicShareable

    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectPhotoPermissions(library.project.id, {
        photoIds,
        reviewStatus: nextReviewStatus,
        ownerVisible: nextOwnerVisible,
        subVendorVisible: nextSubVendorVisible,
        publicShareable: nextPublicShareable,
        photoKind: nextPhotoKind,
      })

      if (result.success) {
        const updatedIds = new Set(photoIds)
        setPhotos((current) =>
          current.map((photo) =>
            updatedIds.has(photo.id)
              ? {
                  ...photo,
                  reviewStatus: nextReviewStatus,
                  ownerVisible: nextOwnerVisible,
                  subVendorVisible: nextSubVendorVisible,
                  publicShareable: nextPublicShareable,
                  photoKind: nextPhotoKind,
                }
              : photo
          )
        )
        setMessage(`Updated ${result.updatedCount} photos.`)
        clearSelection()
      } else {
        setMessage(result.error)
      }
    })
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href={`/dashboard/projects/${library.project.id}`}>
                <IconArrowLeft className="size-4" />
                Project
              </Link>
            </Button>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Photo Review
            </h1>
            <p className="text-sm text-muted-foreground">
              {projectLabel(library)} · Internal staff can review every project
              photo before owners, subs, vendors, or public links can see it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{counts.total} photos</Badge>
            <Badge variant="outline">{counts.needsReview} needs review</Badge>
            <Badge variant="outline">{counts.owner} owner</Badge>
            <Badge variant="outline">{counts.subVendor} subs/vendors</Badge>
            <Badge variant="outline">{counts.internal} internal</Badge>
          </div>
        </div>

        <section className="rounded-lg border bg-background p-3">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Date
                </span>
                <select
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All dates</option>
                  {dates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Visibility
                </span>
                <select
                  value={visibilityFilter}
                  onChange={(event) =>
                    setVisibilityFilter(visibilityFilterValue(event.target.value))
                  }
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All photos</option>
                  <option value="internal">Internal only</option>
                  <option value="owner">Owner visible</option>
                  <option value="subs_vendors">Subs/vendors</option>
                  <option value="public">Public/shareable</option>
                  <option value="needs_review">Needs review</option>
                  <option value="approved">Approved</option>
                </select>
              </label>
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={selectFiltered}
                  disabled={filteredPhotos.length === 0}
                >
                  Select filtered
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearSelection}
                  disabled={selectedIds.length === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={selectedIds.length > 0 ? "default" : "outline"}>
                  {selectedIds.length} selected
                </Badge>
                <select
                  value={reviewStatus}
                  onChange={(event) => setReviewStatus(event.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="needs_review">Needs review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <select
                  value={photoKind}
                  onChange={(event) => setPhotoKind(event.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="progress">Progress</option>
                  <option value="issue">Issue</option>
                  <option value="delivery">Delivery</option>
                  <option value="selection">Selection</option>
                  <option value="archive">Archive</option>
                </select>
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={ownerVisible}
                    onChange={(event) => setOwnerVisible(event.target.checked)}
                  />
                  Owner
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={subVendorVisible}
                    onChange={(event) =>
                      setSubVendorVisible(event.target.checked)
                    }
                  />
                  Subs/vendors
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={publicShareable}
                    onChange={(event) =>
                      setPublicShareable(event.target.checked)
                    }
                  />
                  Public
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={applyPermissions}
                  disabled={selectedIds.length === 0 || isPending}
                >
                  <IconUsers className="size-4" />
                  Apply
                </Button>
              </div>
              {message && (
                <p className="mt-2 text-xs text-muted-foreground">{message}</p>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {filteredPhotos.map((photo) => {
            const selected = selectedSet.has(photo.id)
            const href = browserHref(photo.driveUrl)
            const imageSrc = photo.thumbnailUrl ?? photo.driveUrl

            return (
              <article
                key={photo.id}
                className={`overflow-hidden rounded-md border bg-background ${
                  selected ? "ring-2 ring-primary" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={(event) => togglePhoto(photo.id, event)}
                  className="block w-full text-left"
                  aria-pressed={selected}
                >
                  <div className="relative aspect-[4/3] bg-muted">
                    {imageSrc ? (
                      <Image
                        src={imageSrc}
                        alt={photo.caption ?? photo.fileName}
                        fill
                        sizes="(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 50vw"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <IconPhoto className="size-8 text-muted-foreground" />
                      </div>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
                      {selected ? "Selected" : photo.photoDate}
                    </span>
                  </div>
                  <div className="space-y-2 p-2">
                    <p className="line-clamp-2 min-h-10 text-xs font-medium">
                      {photo.caption ?? photo.fileName}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">{sourceLabel(photo.sourceSystem)}</Badge>
                      <Badge
                        variant={
                          photo.reviewStatus === "approved"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {statusLabel(photo.reviewStatus)}
                      </Badge>
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
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 border-t px-2 py-1.5 text-xs text-primary hover:bg-accent"
                  >
                    <IconExternalLink className="size-3" />
                    Open
                  </a>
                )}
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
