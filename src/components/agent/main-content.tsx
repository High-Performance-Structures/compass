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
  const isCollapsed =
    pathname === "/dashboard" && !hasRenderedUI

  return (
    <div
      className={cn(
        "flex flex-col overflow-x-hidden min-w-0",
        "transition-[flex,opacity] duration-300 ease-in-out",
        isCollapsed
          ? "flex-[0_0_0%] opacity-0 overflow-hidden pointer-events-none"
          : "flex-1 overflow-y-auto pb-14 md:pb-0"
      )}
    >
      <div className="@container/main flex flex-1 flex-col min-w-0">
        {children}
      </div>
    </div>
  )
}
