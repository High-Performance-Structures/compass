import type { ReactNode } from "react"
import { IconCompass } from "@tabler/icons-react"

type ProjectContextWatermarkShellProps = {
  readonly children: ReactNode
}

export function ProjectContextWatermarkShell({
  children,
}: ProjectContextWatermarkShellProps) {
  return (
    <div className="relative flex-1 overflow-hidden p-4 pt-6 sm:p-6 md:p-8">
      <IconCompass
        aria-hidden="true"
        stroke={1}
        className="pointer-events-none absolute -right-16 bottom-8 z-0 size-[32rem] rotate-[-14deg] text-primary/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-background via-background/88 to-background/70"
      />
      <div className="relative z-10 space-y-6">{children}</div>
    </div>
  )
}
