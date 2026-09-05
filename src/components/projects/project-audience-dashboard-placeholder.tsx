import type * as React from "react"
import Image from "next/image"

export function ProjectAudienceDashboardPlaceholder(): React.ReactElement {
  return (
    <div className="relative flex h-full min-h-64 flex-col justify-end overflow-hidden bg-muted">
      <Image
        src="/images/dashboard/custom-home-inspiration.webp"
        alt="Custom-home inspiration: a sunlit limestone and oak entry courtyard"
        fill
        sizes="(min-width: 1280px) 240px, (min-width: 768px) 300px, 45vw"
        unoptimized
        className="object-cover object-center"
      />
      <div className="relative bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-12 pb-5 pr-8">
        <p className="text-xs font-medium text-primary">
          Custom-home inspiration
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Approved project photos will appear here.
        </p>
      </div>
    </div>
  )
}
