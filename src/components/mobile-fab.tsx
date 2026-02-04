"use client"

import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

export interface FabAction {
  icon: React.ReactNode
  label: string
  onClick: () => void
}

interface MobileFabProps {
  icon?: React.ReactNode
  label?: string
  actions?: FabAction[]
  onClick?: () => void
}

export function MobileFab({
  icon,
  label,
  actions,
  onClick,
}: MobileFabProps) {
  const [open, setOpen] = React.useState(false)

  const handleClick = () => {
    if (onClick) {
      onClick()
      return
    }
    if (actions?.length) {
      setOpen(true)
    }
  }

  const fabIcon = icon ?? (
    <IconPlus className="size-5 text-primary" />
  )

  return (
    <>
      {label ? (
        <button
          className={cn(
            "fixed bottom-[72px] right-3 z-[55]",
            "flex h-12 items-center gap-2 px-4",
            "rounded-full bg-background shadow-md border",
            "transition-transform active:scale-95 md:hidden"
          )}
          onClick={handleClick}
          aria-label={label}
        >
          {fabIcon}
          <span className="text-sm font-medium">{label}</span>
        </button>
      ) : (
        <button
          className={cn(
            "fixed bottom-[72px] right-3 z-[55]",
            "flex size-12 items-center justify-center",
            "rounded-full bg-background shadow-md border",
            "transition-transform active:scale-95 md:hidden"
          )}
          onClick={handleClick}
          aria-label="Quick actions"
        >
          {fabIcon}
        </button>
      )}

      {actions && actions.length > 0 && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="p-0"
            showClose={false}
          >
            <SheetHeader className="border-b px-4 py-3 text-left">
              <SheetTitle className="text-base font-medium">
                Quick Actions
              </SheetTitle>
            </SheetHeader>
            <div className="py-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  className={cn(
                    "flex w-full items-center gap-3",
                    "px-4 py-3 text-left active:bg-muted/50"
                  )}
                  onClick={() => {
                    action.onClick()
                    setOpen(false)
                  }}
                >
                  <span
                    className={cn(
                      "flex size-10 items-center",
                      "justify-center rounded-full bg-muted"
                    )}
                  >
                    {action.icon}
                  </span>
                  <span className="text-sm font-medium">
                    {action.label}
                  </span>
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}
