"use client"

import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

export function MainContent({
  children,
  className: classNameProp,
  ...rest
}: React.ComponentPropsWithRef<"div">) {
  const pathname = usePathname()
  const isConversations = pathname?.startsWith("/dashboard/conversations")
  const isSchedule = pathname?.includes("/schedule")
  const needsFixedHeight = isConversations || isSchedule

  return (
    <div
      {...rest}
      className={cn(
        "flex flex-col overflow-x-hidden min-w-0 min-h-0",
        "transition-[flex,opacity] duration-300 ease-in-out",
        needsFixedHeight
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
