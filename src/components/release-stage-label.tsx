"use client"

import type { JSX } from "react"
import { useNative } from "@/hooks/use-native"

export function ReleaseStageLabel(): JSX.Element {
  const native = useNative()

  return (
    <p className="pointer-events-none fixed bottom-3 left-0 right-0 hidden text-center text-xs text-muted-foreground/60 md:block">
      {native ? "Mobile preview" : "Beta build"}
    </p>
  )
}
