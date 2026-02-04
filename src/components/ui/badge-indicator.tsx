import { cn } from "@/lib/utils"

interface BadgeIndicatorProps {
  children: React.ReactNode
  count?: number
  dot?: boolean
  className?: string
}

export function BadgeIndicator({
  children,
  count,
  dot,
  className,
}: BadgeIndicatorProps) {
  const showCount = count !== undefined && count > 0
  const showDot = dot && !showCount

  return (
    <span className={cn("relative inline-flex", className)}>
      {children}
      {showCount && (
        <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
      {showDot && (
        <span className="absolute right-0 top-0 size-2 rounded-full bg-destructive ring-2 ring-background" />
      )}
    </span>
  )
}
