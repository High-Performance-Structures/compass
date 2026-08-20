import type * as React from "react"

import type { ProjectBrand } from "@/lib/project-branding"
import { cn } from "@/lib/utils"

export function ProjectBrandContactDetails({
  brand,
  className,
  lineClassName,
}: {
  readonly brand: ProjectBrand
  readonly className?: string
  readonly lineClassName?: string
}): React.ReactElement {
  return (
    <div
      className={cn("project-brand-contact", className)}
      data-project-brand-contact="true"
    >
      {brand.contactLines.map((line) => (
        <p key={line} className={lineClassName}>
          {line}
        </p>
      ))}
    </div>
  )
}
