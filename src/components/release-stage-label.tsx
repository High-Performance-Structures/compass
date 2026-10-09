"use client"

import Image from "next/image"
import type { JSX } from "react"
import { useNative } from "@/hooks/use-native"

export function ReleaseStageLabel(): JSX.Element {
  const native = useNative()

  return (
    // The company signs the menu: logo, legal name, and the release stage.
    <div className="flex items-center gap-2.5 px-3 pb-2 pt-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <Image
        src="/department-logos/hps-h-green.svg"
        alt="High Performance Structures Inc."
        width={22}
        height={22}
        unoptimized
        className="size-[22px] shrink-0"
      />
      <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
        <span className="truncate text-xs text-sidebar-foreground/80">High Performance Structures Inc.</span>
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-sidebar-foreground/50">
          {native ? "Mobile preview" : "Beta build"}
        </span>
      </span>
    </div>
  )
}
