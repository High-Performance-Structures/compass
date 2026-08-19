import type * as React from "react"
import Image from "next/image"

import type { ProjectBrand } from "@/lib/project-branding"

export function ProjectBrandLogo({
  brand,
  className,
  ownerUpdateMarker = false,
  size,
}: {
  readonly brand: ProjectBrand
  readonly className: string
  readonly ownerUpdateMarker?: boolean
  readonly size: number
}): React.ReactElement {
  return (
    <Image
      src={brand.logoSrc}
      alt={brand.logoAlt}
      width={size}
      height={size}
      priority
      unoptimized
      sizes={`${size}px`}
      data-project-brand-logo="true"
      data-owner-update-brand-logo={ownerUpdateMarker ? "true" : undefined}
      className={className}
    />
  )
}
