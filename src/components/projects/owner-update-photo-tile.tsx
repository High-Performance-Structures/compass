"use client"

import { useState } from "react"
import Image from "next/image"
import { IconExternalLink, IconPhoto } from "@tabler/icons-react"

function browserHref(value: string | null): string | null {
  if (value === null) return null
  if (value.startsWith("https://") || value.startsWith("http://")) return value
  if (value.startsWith("/owner-update-photos/")) return value
  if (value.startsWith("/project-photo-previews/")) return value
  return null
}

export function OwnerUpdatePhotoTile({
  fileName,
  driveUrl,
  thumbnailUrl,
  caption,
}: {
  readonly fileName: string
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
}): React.ReactElement {
  const [imageFailed, setImageFailed] = useState(false)
  const title = caption ?? fileName
  const showImage = thumbnailUrl !== null && !imageFailed
  const href = browserHref(driveUrl)

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="flex aspect-[4/3] items-center justify-center bg-muted/50">
        {showImage ? (
          <Image
            src={thumbnailUrl}
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
              Photo preview
            </span>
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="line-clamp-2 min-h-10 text-xs font-medium">
          {title}
        </p>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
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
