"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconArrowRight,
  IconMapPin,
  IconPhoto,
  IconPhotoEdit,
  IconUpload,
} from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type OwnerCoverPhotoOption = {
  readonly id: string
  readonly fileName: string
  readonly thumbnailUrl: string | null
  readonly caption: string | null
}

type OwnerCoverPhotoSelection =
  | {
      readonly kind: "approved"
      readonly photoId: string
      readonly url: string
    }
  | {
      readonly kind: "uploaded"
      readonly fileName: string
      readonly dataUrl: string
    }

type OwnerCoverPhotoControlProps = {
  readonly projectId: string
  readonly projectTitle: string
  readonly projectLabel: string
  readonly projectAddress: string | null
  readonly latestUpdate:
    | {
        readonly id: string
        readonly title: string
      }
    | null
  readonly nextScheduleItem:
    | {
        readonly title: string
        readonly dateRange: string
      }
    | null
  readonly approvedPhotos: readonly OwnerCoverPhotoOption[]
}

function storageKey(projectId: string): string {
  return `compass-owner-cover-photo:${projectId}`
}

function readCoverSelection(projectId: string): OwnerCoverPhotoSelection | null {
  try {
    const stored = window.localStorage.getItem(storageKey(projectId))
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "kind" in parsed &&
      parsed.kind === "approved" &&
      "photoId" in parsed &&
      typeof parsed.photoId === "string" &&
      "url" in parsed &&
      typeof parsed.url === "string"
    ) {
      return {
        kind: "approved",
        photoId: parsed.photoId,
        url: parsed.url,
      }
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "kind" in parsed &&
      parsed.kind === "uploaded" &&
      "fileName" in parsed &&
      typeof parsed.fileName === "string" &&
      "dataUrl" in parsed &&
      typeof parsed.dataUrl === "string"
    ) {
      return {
        kind: "uploaded",
        fileName: parsed.fileName,
        dataUrl: parsed.dataUrl,
      }
    }
  } catch {
    return null
  }

  return null
}

function saveCoverSelection(
  projectId: string,
  selection: OwnerCoverPhotoSelection | null
): void {
  try {
    if (selection === null) {
      window.localStorage.removeItem(storageKey(projectId))
      return
    }

    window.localStorage.setItem(storageKey(projectId), JSON.stringify(selection))
  } catch {
    // The cover still updates for this session even if local persistence is full.
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }

      reject(new Error("Could not read this image."))
    }
    reader.onerror = () => reject(new Error("Could not read this image."))
    reader.readAsDataURL(file)
  })
}

function resizeImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () => {
      const maxWidth = 1800
      const maxHeight = 1200
      const scale = Math.min(
        1,
        maxWidth / image.naturalWidth,
        maxHeight / image.naturalHeight
      )
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")

      if (!context) {
        resolve(dataUrl)
        return
      }

      context.drawImage(image, 0, 0, width, height)
      resolve(canvas.toDataURL("image/jpeg", 0.86))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

function approvedCoverPhotoUrl(
  selection: OwnerCoverPhotoSelection | null,
  approvedPhotos: readonly OwnerCoverPhotoOption[]
): string | null {
  if (selection?.kind === "uploaded") return selection.dataUrl
  if (selection?.kind === "approved") {
    const selectedPhoto = approvedPhotos.find(
      (photo) => photo.id === selection.photoId
    )

    return selectedPhoto?.thumbnailUrl ?? selection.url
  }

  return approvedPhotos[0]?.thumbnailUrl ?? null
}

export function OwnerCoverPhotoControl({
  projectId,
  projectTitle,
  projectLabel,
  projectAddress,
  latestUpdate,
  nextScheduleItem,
  approvedPhotos,
}: OwnerCoverPhotoControlProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [selection, setSelection] =
    React.useState<OwnerCoverPhotoSelection | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    setSelection(readCoverSelection(projectId))
  }, [projectId])

  const coverUrl = approvedCoverPhotoUrl(selection, approvedPhotos)

  function handleSelectApproved(photo: OwnerCoverPhotoOption): void {
    if (!photo.thumbnailUrl) return

    const nextSelection: OwnerCoverPhotoSelection = {
      kind: "approved",
      photoId: photo.id,
      url: photo.thumbnailUrl,
    }
    setSelection(nextSelection)
    saveCoverSelection(projectId, nextSelection)
    setMessage("Cover photo updated.")
    setOpen(false)
  }

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setMessage("Please choose an image file.")
      return
    }

    setUploading(true)
    setMessage(null)

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const resizedDataUrl = await resizeImageDataUrl(dataUrl)
      const nextSelection: OwnerCoverPhotoSelection = {
        kind: "uploaded",
        fileName: file.name,
        dataUrl: resizedDataUrl,
      }
      setSelection(nextSelection)
      saveCoverSelection(projectId, nextSelection)
      setMessage("Cover photo uploaded.")
      setOpen(false)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not upload this image."
      )
    } finally {
      setUploading(false)
      event.currentTarget.value = ""
    }
  }

  function handleReset(): void {
    setSelection(null)
    saveCoverSelection(projectId, null)
    setMessage("Cover photo reset to the latest approved photo.")
    setOpen(false)
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-[#17231c] text-white shadow-sm">
      <div className="relative min-h-[370px]">
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={`${projectTitle} cover photo`}
            fill
            sizes="(min-width: 1024px) 1120px, 100vw"
            unoptimized
            className="object-cover"
            priority
          />
        ) : (
          <div className="absolute inset-0 bg-[oklch(0.32_0.055_150)]" />
        )}
        <div className="absolute inset-0 bg-black/45" />
        <div className="relative flex min-h-[370px] flex-col justify-between gap-6 p-5 sm:p-8">
          <div className="flex justify-end">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-white/90 text-[#17231c] hover:bg-white"
                >
                  <IconPhotoEdit className="size-4" />
                  Change cover
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Choose a cover photo</DialogTitle>
                  <DialogDescription>
                    Pick from approved project photos or upload a personal
                    cover image for this project view.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5">
                  <div className="rounded-md border p-4">
                    <div className="flex items-center gap-2">
                      <IconUpload className="size-4 text-muted-foreground" />
                      <p className="text-sm font-medium">Upload your own</p>
                    </div>
                    <Input
                      type="file"
                      accept="image/*"
                      className="mt-3"
                      disabled={uploading}
                      onChange={handleUpload}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      For this preview, uploaded covers are saved on this
                      device. Approved project photos remain the shared source
                      of truth.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <IconPhoto className="size-4 text-muted-foreground" />
                        <p className="text-sm font-medium">
                          Approved project photos
                        </p>
                      </div>
                      <Badge variant="outline">
                        {
                          approvedPhotos.filter(
                            (photo) => photo.thumbnailUrl !== null
                          ).length
                        }{" "}
                        available
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {approvedPhotos
                        .filter((photo) => photo.thumbnailUrl !== null)
                        .map((photo) => (
                          <button
                            key={photo.id}
                            type="button"
                            className="group overflow-hidden rounded-md border bg-background text-left transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
                            onClick={() => handleSelectApproved(photo)}
                          >
                            {photo.thumbnailUrl && (
                              <div className="relative aspect-[4/3]">
                                <Image
                                  src={photo.thumbnailUrl}
                                  alt={photo.caption ?? photo.fileName}
                                  fill
                                  sizes="240px"
                                  unoptimized
                                  className="object-cover"
                                />
                              </div>
                            )}
                            <div className="p-2">
                              <p className="line-clamp-2 text-xs font-medium">
                                {photo.caption ?? photo.fileName}
                              </p>
                            </div>
                          </button>
                        ))}
                    </div>
                    {approvedPhotos.every(
                      (photo) => photo.thumbnailUrl === null
                    ) && (
                      <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">
                        No approved project photos are ready for cover selection
                        yet.
                      </p>
                    )}
                  </div>
                </div>

                {message && (
                  <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                    {message}
                  </p>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="secondary" onClick={handleReset}>
                    Use latest approved photo
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex flex-col gap-6">
            <div className="max-w-3xl">
              <Badge className="bg-white/90 text-[#17231c] hover:bg-white">
                Owner project home
              </Badge>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
                {projectTitle}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-white/85">
                <span>{projectLabel}</span>
                {projectAddress && (
                  <>
                    <span>&middot;</span>
                    <span className="inline-flex items-center gap-1">
                      <IconMapPin className="size-4" />
                      {projectAddress}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-md border border-white/20 bg-white/12 p-4 backdrop-blur">
                <p className="text-xs font-medium uppercase text-white/65">
                  Latest update
                </p>
                <p className="mt-2 line-clamp-2 text-sm font-medium">
                  {latestUpdate?.title ??
                    "Your next project update is being prepared."}
                </p>
                {latestUpdate && (
                  <a
                    href={`/dashboard/projects/${projectId}/owner-updates/${latestUpdate.id}`}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-white hover:underline"
                  >
                    Read update
                    <IconArrowRight className="size-3" />
                  </a>
                )}
              </div>
              <div className="rounded-md border border-white/20 bg-white/12 p-4 backdrop-blur">
                <p className="text-xs font-medium uppercase text-white/65">
                  Coming next
                </p>
                <p className="mt-2 line-clamp-2 text-sm font-medium">
                  {nextScheduleItem?.title ??
                    "Upcoming schedule items will appear here."}
                </p>
                {nextScheduleItem && (
                  <p className="mt-2 text-xs text-white/75">
                    {nextScheduleItem.dateRange}
                  </p>
                )}
              </div>
              <div className="rounded-md border border-white/20 bg-white/12 p-4 backdrop-blur sm:col-span-2 lg:col-span-1">
                <p className="text-xs font-medium uppercase text-white/65">
                  Photo gallery
                </p>
                <p className="mt-2 text-sm font-medium">
                  {approvedPhotos.length} approved project photos
                </p>
                <a
                  href="#photos"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-white hover:underline"
                >
                  View photos
                  <IconArrowRight className="size-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
