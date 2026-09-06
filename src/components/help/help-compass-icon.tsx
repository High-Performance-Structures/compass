import * as React from "react"
import { IconCompass } from "@tabler/icons-react"

import { cn } from "@/lib/utils"

/** A compact Compass-specific help mark: compass bearings around a question mark. */
export function HelpCompassIcon({
  className,
  ...props
}: React.ComponentProps<"span">): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-flex size-4 items-center justify-center", className)}
      {...props}
    >
      <IconCompass className="size-full opacity-80" />
      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold leading-none">
        ?
      </span>
    </span>
  )
}
