"use client"

import * as React from "react"
import Image from "next/image"
import { IconPhotoEdit, IconUpload, IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { SidebarUser } from "@/lib/auth"

const HIDDEN_DESK_PHOTO = "__hidden__"
const DESK_PHOTO_ENDPOINT = "/api/users/desk-photo"

type DeskPhotoMetadata =
  | { readonly state: "default" }
  | { readonly state: "hidden"; readonly updatedAt: string }
  | { readonly state: "custom"; readonly updatedAt: string }

function storageKey(user: SidebarUser): string {
  return `compass-desk-photo:${user.email}`
}

function readStoredPhoto(user: SidebarUser): string | null | typeof HIDDEN_DESK_PHOTO {
  try {
    const storedPhoto = window.localStorage.getItem(storageKey(user))

    if (storedPhoto === null || storedPhoto === HIDDEN_DESK_PHOTO) {
      return storedPhoto
    }

    const trimmedPhoto = storedPhoto.trim()
    return trimmedPhoto.length > 0 ? trimmedPhoto : null
  } catch {
    return null
  }
}

function saveStoredPhoto(user: SidebarUser, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(storageKey(user))
      return
    }

    window.localStorage.setItem(storageKey(user), value)
  } catch {
    // The preview can still update for this session if storage is unavailable.
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
      const maxWidth = 900
      const maxHeight = 700
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

function parseDeskPhotoMetadata(value: unknown): DeskPhotoMetadata | null {
  if (!value || typeof value !== "object" || !("state" in value)) return null
  if (value.state === "default") return { state: "default" }

  if (
    (value.state === "hidden" || value.state === "custom") &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  ) {
    return { state: value.state, updatedAt: value.updatedAt }
  }

  return null
}

function durablePhotoUrl(updatedAt: string): string {
  return `${DESK_PHOTO_ENDPOINT}?v=${encodeURIComponent(updatedAt)}`
}

async function readMetadata(response: Response): Promise<DeskPhotoMetadata> {
  const payload: unknown = await response.json()
  const metadata = parseDeskPhotoMetadata(payload)
  if (!response.ok || metadata === null) {
    throw new Error("Compass could not save this desk photo.")
  }
  return metadata
}

async function uploadDeskPhoto(dataUrl: string): Promise<DeskPhotoMetadata> {
  const imageResponse = await fetch(dataUrl)
  const imageBlob = await imageResponse.blob()
  const formData = new FormData()
  formData.append("photo", imageBlob, "desk-photo.jpg")

  const response = await fetch(DESK_PHOTO_ENDPOINT, {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  })
  return readMetadata(response)
}

async function updateDeskPhotoVisibility(
  mode: "hide" | "reset",
): Promise<DeskPhotoMetadata> {
  const response = await fetch(`${DESK_PHOTO_ENDPOINT}?mode=${mode}`, {
    method: "DELETE",
    credentials: "same-origin",
  })
  return readMetadata(response)
}

export function PersonalDeskPhoto({
  user,
}: {
  readonly user: SidebarUser | null
}): React.ReactElement | null {
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!user) return
    const activeUser = user
    let active = true

    async function loadDeskPhoto(): Promise<void> {
      const storedPhoto = readStoredPhoto(activeUser)

      try {
        const response = await fetch(`${DESK_PHOTO_ENDPOINT}?metadata=1`, {
          credentials: "same-origin",
          cache: "no-store",
        })
        const metadata = await readMetadata(response)
        if (!active) return

        if (metadata.state === "custom") {
          setPhotoUrl(durablePhotoUrl(metadata.updatedAt))
          return
        }
        if (metadata.state === "hidden") {
          setPhotoUrl(null)
          saveStoredPhoto(activeUser, HIDDEN_DESK_PHOTO)
          return
        }

        // One-time migration from the former browser-only preference.
        if (storedPhoto === HIDDEN_DESK_PHOTO) {
          await updateDeskPhotoVisibility("hide")
          if (active) setPhotoUrl(null)
          return
        }
        if (storedPhoto?.startsWith("data:image/")) {
          const migrated = await uploadDeskPhoto(storedPhoto)
          if (active && migrated.state === "custom") {
            setPhotoUrl(durablePhotoUrl(migrated.updatedAt))
          }
          return
        }

        setPhotoUrl(storedPhoto)
      } catch {
        if (!active) return
        setPhotoUrl(
          storedPhoto === HIDDEN_DESK_PHOTO
            ? null
            : storedPhoto,
        )
      }
    }

    void loadDeskPhoto()
    return () => {
      active = false
    }
  }, [user])

  if (!user) {
    return null
  }

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    if (!user) return

    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file.")
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const resizedDataUrl = await resizeImageDataUrl(dataUrl)
      const metadata = await uploadDeskPhoto(resizedDataUrl)
      if (metadata.state !== "custom") {
        throw new Error("Compass did not return the saved desk photo.")
      }

      saveStoredPhoto(user, resizedDataUrl)
      setPhotoUrl(durablePhotoUrl(metadata.updatedAt))
      setMessage("Desk photo saved to Compass.")
    } catch (error: unknown) {
      setMessage(
        error instanceof Error ? error.message : "Desk photo could not be saved.",
      )
    } finally {
      setSaving(false)
      input.value = ""
    }
  }

  async function handleReset(): Promise<void> {
    if (!user) return

    setSaving(true)
    setMessage(null)
    try {
      await updateDeskPhotoVisibility("reset")
      setPhotoUrl(null)
      saveStoredPhoto(user, null)
      setMessage("Desk photo cleared.")
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Desk photo could not be reset.")
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(): Promise<void> {
    if (!user) return

    setSaving(true)
    setMessage(null)
    try {
      await updateDeskPhotoVisibility("hide")
      setPhotoUrl(null)
      saveStoredPhoto(user, HIDDEN_DESK_PHOTO)
      setMessage("Desk photo removed.")
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Desk photo could not be removed.")
    } finally {
      setSaving(false)
    }
  }

  function handlePhotoError(): void {
    if (!user) return

    const storedPhoto = readStoredPhoto(user)
    const cachedPhoto =
      storedPhoto && storedPhoto !== HIDDEN_DESK_PHOTO
        ? storedPhoto
        : null
    if (cachedPhoto !== null && photoUrl !== cachedPhoto) {
      setPhotoUrl(cachedPhoto)
      setMessage("Showing the cached desk photo while Compass reconnects.")
      return
    }

    setPhotoUrl(null)
  }

  const hasPhoto = photoUrl !== null

  return (
    <div className="group-data-[collapsible=icon]:hidden px-2 pb-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group/photo block w-full rounded-md border border-sidebar-border bg-sidebar-accent/30 p-1.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-sidebar-accent hover:shadow-md"
            aria-label={hasPhoto ? "Edit desk photo" : "Add desk photo"}
          >
            <div className="relative aspect-[16/10] overflow-hidden rounded-sm bg-sidebar-accent">
              {hasPhoto ? (
                <Image
                  src={photoUrl}
                  alt={`${user.name}'s desk photo`}
                  fill
                  sizes="240px"
                  unoptimized
                  onError={handlePhotoError}
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-sidebar-foreground/70">
                  <IconPhotoEdit className="size-5" />
                  <span className="text-[11px] font-medium">Add desk photo</span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/45 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition group-hover/photo:opacity-100">
                <span>{hasPhoto ? "Desk photo" : "Add photo"}</span>
                <IconPhotoEdit className="size-3.5" />
              </div>
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-72">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Desk photo</p>
              <p className="mt-1 text-xs text-muted-foreground">
                A small personal photo for your Compass sidebar.
              </p>
            </div>
            {hasPhoto ? (
              <div className="relative aspect-[16/10] overflow-hidden rounded-md border bg-muted">
                <Image
                  src={photoUrl}
                  alt={`${user.name}'s desk photo preview`}
                  fill
                  sizes="288px"
                  unoptimized
                  onError={handlePhotoError}
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 text-muted-foreground">
                <IconPhotoEdit className="size-6" />
                <p className="text-xs font-medium">No desk photo yet</p>
              </div>
            )}
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <IconUpload className="size-3.5" />
                Change photo
              </span>
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleUpload}
                disabled={saving}
              />
            </label>
            {message && (
              <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                {message}
              </p>
            )}
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={saving}
              >
                {saving ? "Saving..." : "Reset"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                disabled={!hasPhoto || saving}
              >
                <IconX className="size-4" />
                Remove
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
