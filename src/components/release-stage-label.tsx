"use client"

import Image from "next/image"
import type { JSX } from "react"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { useNative } from "@/hooks/use-native"
import { departmentLogoSrc } from "@/lib/department-profiles"

export function ReleaseStageLabel(): JSX.Element {
  const native = useNative()
  // The company's main entity (the "H" profile) signs the menu, from Settings → Company.
  const company = useDepartmentProfiles().H

  return (
    // The company signs the menu: logo, legal name, and the release stage.
    <div className="flex items-center gap-2.5 px-3 pb-2 pt-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <Image
        src={departmentLogoSrc("H", company)}
        alt={company.legalName}
        width={22}
        height={22}
        unoptimized
        className="size-[22px] shrink-0"
      />
      <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
        <span className="truncate text-xs text-sidebar-foreground/80">{company.legalName}</span>
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-sidebar-foreground/50">
          {native ? "Mobile preview" : "Beta build"}
        </span>
      </span>
    </div>
  )
}
