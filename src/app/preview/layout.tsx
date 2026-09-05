import type * as React from "react"

import { Toaster } from "@/components/ui/sonner"

export default function PreviewLayout({
  children,
}: {
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <>
      {children}
      <Toaster position="bottom-right" />
    </>
  )
}
