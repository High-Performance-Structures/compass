"use client"

import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useRenderState } from "./chat-provider"

export function MainContent({
  children,
  className: classNameProp,
  ...rest
}: React.ComponentPropsWithRef<"div">) {
  const pathname = usePathname()
  const { spec, isRendering } = useRenderState()
  const hasRenderedUI = !!spec?.root || isRendering
  const isCollapsed =
    pathname === "/dashboard" && !hasRenderedUI
  const isConversations = pathname?.startsWith("/dashboard/conversations")
  const isSchedule = pathname?.includes("/schedule")
  const needsFixedHeight = isConversations || isSchedule

  return (
    <div
      {...rest}
      className={cn(
        "flex flex-col overflow-x-hidden min-w-0 min-h-0",
        "transition-[flex,opacity] duration-300 ease-in-out",
        isCollapsed
          ? "flex-[0_0_0%] opacity-0 overflow-hidden pointer-events-none"
          : needsFixedHeight
            ? "flex-1 overflow-hidden"
            : "flex-1 overflow-y-auto pb-14 md:pb-0",
        classNameProp
      )}
    >
      <div className={cn(
        "@container/main flex flex-1 flex-col min-w-0 min-h-0",
        needsFixedHeight && "overflow-hidden"
      )}>
        {children}
      </div>
    </div>
  )
}
