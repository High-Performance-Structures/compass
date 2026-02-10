"use client"

import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useRenderState } from "./chat-provider"

export function MainContent({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const pathname = usePathname()
  const { spec, isRendering } = useRenderState()
  const hasRenderedUI = !!spec?.root || isRendering
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden min-w-0 transition-[flex,opacity] duration-300 ease-in-out",
        "flex-1 pb-4 md:pb-0" // Updated to standard safe area padding
      )}
    >
      <div className="@container/main flex flex-1 flex-col min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
