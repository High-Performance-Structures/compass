"use client"

import type { JSX } from "react"
import { useNative } from "@/hooks/use-native"

export function ReleaseStageLabel(): JSX.Element {
  const native = useNative()

  return (
    <p className="px-3 pb-2 pt-1 font-mono text-xs uppercase tracking-[0.16em] text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
      {native ? "Mobile preview" : "Beta build"}
    </p>
  )
}
