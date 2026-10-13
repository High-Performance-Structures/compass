import type * as React from "react"
import Image from "next/image"

import { cn } from "@/lib/utils"

/** The default photo shown until the project has approved photos. */
export function ProjectAudienceDashboardPlaceholder({
  compact = false,
}: {
  /** Sized for the small photo beside the dashboard greeting. */
  readonly compact?: boolean
}): React.ReactElement {
  return (
    <div
      className={cn(
        "relative flex h-full flex-col justify-end overflow-hidden bg-muted",
        compact ? "min-h-full" : "min-h-64"
      )}
    >
      <Image
        src="/images/dashboard/custom-home-inspiration.webp"
        alt="Custom-home inspiration: a sunlit limestone and oak entry courtyard"
        fill
        sizes={compact ? "(min-width: 640px) 240px, 100vw" : "(min-width: 1280px) 240px, (min-width: 768px) 300px, 45vw"}
        unoptimized
        className="object-cover object-center"
      />
      <div
        className={cn(
          "relative bg-gradient-to-t from-background via-background/90 to-transparent",
          compact ? "px-3 pt-8 pb-2.5" : "px-4 pt-12 pb-5 pr-8"
        )}
      >
        <p className="text-xs font-medium text-primary">Custom-home inspiration</p>
        <p className={cn("mt-1 text-xs text-muted-foreground", compact ? "leading-snug" : "leading-relaxed")}>
          Approved project photos will appear here.
        </p>
      </div>
    </div>
  )
}
