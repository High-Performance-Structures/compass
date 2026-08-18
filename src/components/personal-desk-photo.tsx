"use client"

import * as React from "react"
import Image from "next/image"
import { IconPhotoEdit, IconUpload, IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateWorkspacePhoto } from "@/app/actions/profile"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { SidebarUser } from "@/lib/auth"
import {
  authorizedWorkspacePhotoUrl,
  dashboardDeskPhotoStorageKey,
  HIDDEN_DESK_PHOTO,
  workspacePhotoStateKey,
} from "@/lib/user-photo-storage"

function storageKey(user: SidebarUser): string | null {
  if (!user.canUseWorkspacePhotos) return null
  if (!user.organizationId) return null
  return dashboardDeskPhotoStorageKey(user.id, user.organizationId)
}

function readStoredPhoto(user: SidebarUser): string | null | typeof HIDDEN_DESK_PHOTO {
  const key = storageKey(user)
  if (!key) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function saveStoredPhoto(user: SidebarUser, value: string | null): void {
  const key = storageKey(user)
  if (!key) return
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
      return
    }

    window.localStorage.setItem(key, value)
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

export function PersonalDeskPhoto({
  user,
}: {
  readonly user: SidebarUser | null
}): React.ReactElement | null {
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null)
  const [photoScope, setPhotoScope] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const currentPhotoScope = user
    ? workspacePhotoStateKey({
        userId: user.id,
        organizationId: user.organizationId,
        slot: "dashboard",
        canUseWorkspacePhotos: user.canUseWorkspacePhotos,
        serverPhotoUrl: user.dashboardDeskPhoto,
      })
    : "no-user"

  React.useEffect(() => {
    if (!user) return
    setPhotoScope(currentPhotoScope)
    if (!user.canUseWorkspacePhotos) {
      setPhotoUrl(null)
      return
    }

    const serverPhoto = user.dashboardDeskPhoto
    const storedPhoto = readStoredPhoto(user)
    setPhotoUrl(
      serverPhoto === HIDDEN_DESK_PHOTO ? null : serverPhoto ?? storedPhoto
    )

    if (serverPhoto !== null || !storedPhoto) return
    const legacyPhoto = storedPhoto
    if (!legacyPhoto) return
    if (legacyPhoto === HIDDEN_DESK_PHOTO) {
      void updateWorkspacePhoto("dashboard", HIDDEN_DESK_PHOTO)
      return
    }

    void updateWorkspacePhoto("dashboard", legacyPhoto).then((result) => {
      if (result.success && result.data?.url) setPhotoUrl(result.data.url)
    })
  }, [currentPhotoScope, user])

  const renderedPhotoUrl = authorizedWorkspacePhotoUrl({
    canUseWorkspacePhotos: user?.canUseWorkspacePhotos === true,
    currentScope: currentPhotoScope,
    loadedScope: photoScope,
    photoUrl,
  })

  if (!user || renderedPhotoUrl === null) {
    return null
  }

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    if (!user) return

    const file = event.currentTarget.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file.")
      return
    }

    const dataUrl = await readFileAsDataUrl(file)
    const resizedDataUrl = await resizeImageDataUrl(dataUrl)
    const result = await updateWorkspacePhoto("dashboard", resizedDataUrl)
    if (!result.success) {
      setMessage(result.error)
      return
    }
    setPhotoUrl(result.data?.url ?? resizedDataUrl)
    saveStoredPhoto(user, resizedDataUrl)
    setMessage("Desk photo updated.")
    event.currentTarget.value = ""
  }

  async function handleReset(): Promise<void> {
    if (!user) return

    const result = await updateWorkspacePhoto("dashboard", HIDDEN_DESK_PHOTO)
    if (!result.success) {
      setMessage(result.error)
      return
    }
    setPhotoUrl(null)
    saveStoredPhoto(user, null)
    setMessage("Desk photo reset.")
  }

  async function handleRemove(): Promise<void> {
    if (!user) return

    const result = await updateWorkspacePhoto("dashboard", HIDDEN_DESK_PHOTO)
    if (!result.success) {
      setMessage(result.error)
      return
    }
    setPhotoUrl(null)
    saveStoredPhoto(user, HIDDEN_DESK_PHOTO)
    setMessage("Desk photo removed.")
  }

  return (
    <div className="group-data-[collapsible=icon]:hidden px-2 pb-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group/photo block w-full rounded-md border border-sidebar-border bg-sidebar-accent/30 p-1.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-sidebar-accent hover:shadow-md"
            aria-label="Edit desk photo"
          >
            <div className="relative aspect-[16/10] overflow-hidden rounded-sm bg-sidebar-accent">
              <Image
                src={renderedPhotoUrl}
                alt={`${user.name}'s desk photo`}
                fill
                sizes="240px"
                unoptimized
                className="object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/45 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition group-hover/photo:opacity-100">
                <span>Desk photo</span>
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
            <div className="relative aspect-[16/10] overflow-hidden rounded-md border bg-muted">
              <Image
                src={renderedPhotoUrl}
                alt={`${user.name}'s desk photo preview`}
                fill
                sizes="288px"
                unoptimized
                className="object-cover"
              />
            </div>
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <IconUpload className="size-3.5" />
                Change photo
              </span>
              <Input type="file" accept="image/*" onChange={handleUpload} />
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
                onClick={() => void handleReset()}
              >
                Reset
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRemove()}
              >
                <IconX className="size-4" />
                Hide
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
