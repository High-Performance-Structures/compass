"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconCamera,
  IconCheck,
  IconMoon,
  IconPalette,
  IconSun,
} from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useCompassTheme, useTheme } from "@/components/theme-provider"
import { THEME_PRESETS } from "@/lib/theme/presets"
import { sidebarDeskPhotoStorageKey } from "@/lib/user-photo-storage"
import { cn } from "@/lib/utils"

type AudienceViewer = {
  readonly name: string
  readonly email: string
  readonly avatarUrl: string | null
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

function resizeSidebarPhoto(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () => {
      const scale = Math.min(
        1,
        720 / image.naturalWidth,
        420 / image.naturalHeight
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
      resolve(canvas.toDataURL("image/jpeg", 0.84))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

export function ProjectAudienceSidebarProfile({
  viewer,
}: {
  readonly viewer: AudienceViewer
}): React.ReactElement {
  const { theme, setTheme } = useTheme()
  const { activeThemeId, setVisualTheme } = useCompassTheme()
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(
    viewer.avatarUrl
  )
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    try {
      setPhotoUrl(
        window.localStorage.getItem(sidebarDeskPhotoStorageKey(viewer.email)) ??
          viewer.avatarUrl
      )
    } catch {
      setPhotoUrl(viewer.avatarUrl)
    }
  }, [viewer.avatarUrl, viewer.email])

  async function handlePhoto(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.")
      return
    }

    try {
      const photo = await resizeSidebarPhoto(await readFileAsDataUrl(file))
      window.localStorage.setItem(
        sidebarDeskPhotoStorageKey(viewer.email),
        photo
      )
      setPhotoUrl(photo)
      toast.success("Sidebar photo updated.")
    } catch {
      toast.error("Could not update the sidebar photo.")
    }
  }

  return (
    <div className="space-y-2 border-t border-sidebar-border p-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhoto}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="group relative block h-24 w-full overflow-hidden rounded-md border border-sidebar-border bg-sidebar-accent text-left"
        aria-label="Change sidebar photo"
      >
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={`${viewer.name}'s sidebar photo`}
            fill
            sizes="240px"
            unoptimized
            className="object-cover"
          />
        ) : (
          <span className="grid h-full place-items-center text-sm font-medium text-sidebar-foreground">
            Add your photo
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Change photo
          <IconCamera className="size-3.5" />
        </span>
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-start">
            <IconPalette className="size-4" />
            Appearance
          </Button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-72">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">Appearance</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Make this Compass workspace feel like yours.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("light")}
              >
                <IconSun className="size-4" />
                Light
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("dark")}
              >
                <IconMoon className="size-4" />
                Dark
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => void setVisualTheme(preset.id)}
                  className={cn(
                    "flex min-h-10 items-center justify-between border px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                    activeThemeId === preset.id && "border-primary"
                  )}
                >
                  <span>{preset.name}</span>
                  {activeThemeId === preset.id && (
                    <IconCheck className="size-3.5 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
