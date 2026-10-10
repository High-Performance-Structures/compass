import { IconCompass } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

/** The Compass loading mark: a compass with a spinning needle and a label. */
export function CompassLoader({
  label,
  className,
}: {
  readonly label: string
  readonly className?: string
}): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("flex flex-col items-center gap-3 text-muted-foreground", className)}
    >
      <span className="relative grid size-10 place-items-center">
        <IconCompass className="size-10 text-primary" />
        <span className="absolute h-6 w-px origin-center animate-spin bg-primary" />
      </span>
      <p className="text-sm font-medium">{label}</p>
    </div>
  )
}

/**
 * Covers the screen while a long action runs (AI drafting, building a
 * document), so the page doesn't look frozen and can't be clicked twice.
 */
export function CompassLoadingOverlay({
  label,
}: {
  readonly label: string
}): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm print:hidden">
      <CompassLoader label={label} />
    </div>
  )
}
