"use client"

import { useState } from "react"
import Image from "next/image"
import { IconExternalLink, IconPhoto } from "@tabler/icons-react"

import {
  photoLinkHref,
  resolvePhotoImageSource,
} from "@/lib/photo-sources"

function externalHref(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://")
}

export function OwnerUpdatePhotoTile({
  fileName,
  driveFileId,
  driveUrl,
  thumbnailUrl,
  caption,
  allowExternalSource = false,
}: {
  readonly fileName: string
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly allowExternalSource?: boolean
}): React.ReactElement {
  const [imageFailed, setImageFailed] = useState(false)
  const title = caption ?? fileName
  const resolvedImage = resolvePhotoImageSource({
    driveFileId,
    driveUrl,
    thumbnailUrl,
  })
  const imageSrc = imageFailed ? null : resolvedImage.src
  const href = photoLinkHref(driveUrl, {
    allowExternalSource,
  })
  const opensExternally = href !== null && externalHref(href)

  return (
    <div className="owner-update-photo-tile overflow-hidden rounded-md border bg-background print:break-inside-avoid print:rounded-none">
      <div className="owner-update-photo-frame flex aspect-[4/3] items-center justify-center bg-muted/50">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={title}
            width={320}
            height={240}
            unoptimized
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
            <IconPhoto className="size-8 text-muted-foreground" />
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {resolvedImage.label}
            </span>
          </div>
        )}
      </div>
      <div className="p-2">
        {caption && (
          <p className="line-clamp-2 text-xs font-medium">
            {caption}
          </p>
        )}
        {href && (
          <a
            href={href}
            target={opensExternally ? "_blank" : undefined}
            rel={opensExternally ? "noreferrer" : undefined}
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline print:hidden"
            aria-label={`Open ${fileName}`}
          >
            <IconExternalLink className="size-3" />
            Open
          </a>
        )}
      </div>
    </div>
  )
}
