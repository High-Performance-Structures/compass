import type { ReactElement } from "react"
import Image from "next/image"

import { cn } from "@/lib/utils"

export function YoutubeLogo({
  className,
}: {
  readonly className?: string
}): ReactElement {
  return (
    <span
      className={cn(
        "bg-brand-youtube-surface inline-flex shrink-0 items-center px-1",
        className
      )}
    >
      <Image
        src="/brand/youtube-logo.svg"
        alt="YouTube"
        width={89}
        height={20}
        className="h-5 w-auto"
      />
    </span>
  )
}
