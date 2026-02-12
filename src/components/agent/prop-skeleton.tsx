import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type PropSkeletonType =
  | "text"
  | "text-short"
  | "number"
  | "date"
  | "badge"
  | "badge-lg"
  | "avatar"
  | "table-row"
  | "card"
  | "button"

interface PropSkeletonProps {
  readonly type: PropSkeletonType
  readonly className?: string
  readonly count?: number
}

const skeletonVariants: Record<PropSkeletonType, string> = {
  text: "h-4 w-full",
  "text-short": "h-4 w-24",
  number: "h-4 w-16",
  date: "h-4 w-28",
  badge: "h-5 w-16 rounded-full",
  "badge-lg": "h-6 w-20 rounded-full",
  avatar: "h-8 w-8 rounded-full",
  "table-row": "h-12 w-full rounded-md",
  card: "h-32 w-full rounded-lg",
  button: "h-9 w-24 rounded-md",
}

export function PropSkeleton({
  type,
  className,
  count = 1,
}: PropSkeletonProps): React.ReactNode {
  const baseClasses = skeletonVariants[type]

  if (count > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className={cn(baseClasses, className)} />
        ))}
      </div>
    )
  }

  return <Skeleton className={cn(baseClasses, className)} />
}

// Convenience components for common patterns
export function TextSkeleton({ className }: { className?: string }) {
  return <PropSkeleton type="text" className={className} />
}

export function BadgeSkeleton({ className }: { className?: string }) {
  return <PropSkeleton type="badge" className={className} />
}

export function TableRowSkeleton({
  columns = 4,
  className,
}: {
  columns?: number
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
  )
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-lg border p-4", className)}>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}
