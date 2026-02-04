"use client"

import * as React from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { CarouselPages } from "@/components/ui/carousel-pages"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

interface ResponsiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  title?: string
  description?: string
  className?: string
  /**
   * Use Sheet on mobile instead of Dialog
   * @default false - uses Dialog with mobile optimizations
   */
  useSheetOnMobile?: boolean
}

/**
 * A responsive dialog component based on the account modal pattern.
 * Provides consistent mobile and desktop experience with proper scrolling.
 *
 * Key features:
 * - Max height 90vh with scrollable content
 * - Optimized padding: p-4 on mobile, p-6 on desktop
 * - Consistent text sizing: title is text-base, description is text-xs
 * - Content spacing: space-y-3 with py-1
 *
 * @example
 * ```tsx
 * <ResponsiveDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="Account Settings"
 *   description="Manage your profile"
 * >
 *   <ResponsiveDialogBody>
 *     <form>...</form>
 *   </ResponsiveDialogBody>
 *   <ResponsiveDialogFooter>
 *     <Button>Save</Button>
 *   </ResponsiveDialogFooter>
 * </ResponsiveDialog>
 * ```
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
  title,
  description,
  className,
  useSheetOnMobile = false,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile()

  if (isMobile && useSheetOnMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={cn(
            "max-h-[90vh] flex flex-col p-4 sm:p-6",
            className
          )}
        >
          {(title || description) && (
            <SheetHeader className="space-y-1 text-left shrink-0">
              {title && (
                <SheetTitle className="text-base">
                  {title}
                </SheetTitle>
              )}
              {description && (
                <SheetDescription className="text-xs">
                  {description}
                </SheetDescription>
              )}
            </SheetHeader>
          )}
          {children}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "w-[calc(100%-2rem)] max-w-md max-h-[90vh] flex flex-col p-4 sm:p-6",
          className
        )}
      >
        {(title || description) && (
          <DialogHeader className="space-y-1 shrink-0">
            {title && (
              <DialogTitle className="text-base">
                {title}
              </DialogTitle>
            )}
            {description && (
              <DialogDescription className="text-xs">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
        )}
        {children}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Body container for ResponsiveDialog content.
 * Scrollable when content exceeds available space.
 * On mobile, if pages prop is provided, renders as swipeable carousel.
 */
export function ResponsiveDialogBody({
  children,
  className,
  pages,
}: {
  children?: React.ReactNode
  className?: string
  pages?: React.ReactNode[]
}) {
  const isMobile = useIsMobile()

  // If pages are provided and we're on mobile, use carousel
  if (pages && pages.length > 0 && isMobile) {
    return (
      <div className={cn("overflow-hidden flex-1 min-h-0 flex flex-col", className)}>
        <CarouselPages>
          {pages.map((page, index) => (
            <div key={index} className="space-y-4 py-2 px-1 overflow-y-auto">
              {page}
            </div>
          ))}
        </CarouselPages>
      </div>
    )
  }

  // Default: single scrollable container
  return (
    <div className={cn("space-y-2.5 py-1 overflow-y-auto flex-1 min-h-0", className)}>
      {children}
    </div>
  )
}

/**
 * Footer with action buttons for ResponsiveDialog.
 * Buttons stack vertically on mobile (reverse order), horizontally on desktop.
 * Uses h-9 for buttons to match account modal.
 */
export function ResponsiveDialogFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 shrink-0",
        className
      )}
    >
      {children}
    </div>
  )
}
