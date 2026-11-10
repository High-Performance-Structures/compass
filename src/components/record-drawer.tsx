"use client"

/**
 * The standard record drawer: every list opens and creates its records in a
 * right-side drawer over the list, so the list stays where it was. Matches the
 * RFI create drawer (720px). See docs/development/ui-standards.md, "Record
 * drawer".
 */

import * as React from "react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const RECORD_DRAWER_CONTENT_CLASS = "w-[min(94vw,720px)] overflow-y-auto sm:max-w-none"

export function RecordDrawer({
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  hideHeader = false,
  headerActions,
  footer,
  className,
  children,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: React.ReactNode
  /** One line under the title; also read to screen readers. */
  readonly description?: React.ReactNode
  /** Small label above the title, e.g. "CO-13 · Owner change order". */
  readonly eyebrow?: React.ReactNode
  /** Keep the title for screen readers only, when the body has its own heading. */
  readonly hideHeader?: boolean
  readonly headerActions?: React.ReactNode
  /** Sticky footer, e.g. "Open full page" and Save. */
  readonly footer?: React.ReactNode
  readonly className?: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn(RECORD_DRAWER_CONTENT_CLASS, "flex flex-col gap-0", className)}>
        <SheetHeader className={cn("border-b px-5 py-4", hideHeader && "sr-only")}>
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
          ) : null}
          <SheetTitle className="pr-8">{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">Record details</SheetDescription>
          )}
          {headerActions ? <div className="flex flex-wrap items-center gap-2 pt-1">{headerActions}</div> : null}
        </SheetHeader>
        <div className={cn("flex-1 px-5 pt-4 pb-6", hideHeader && "pt-10")}>{children}</div>
        {footer ? (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t bg-background px-5 py-3">
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Keeps the open record in the URL (`?item=`) so a link to it can be shared,
 * without reloading the page. Closing removes it.
 */
export function useRecordDrawerItem(
  initialItemId: string | null = null
): readonly [string | null, (id: string) => void, () => void] {
  const [itemId, setItemId] = React.useState<string | null>(initialItemId)
  const open = React.useCallback((id: string): void => {
    setItemId(id)
    const url = new URL(window.location.href)
    url.searchParams.set("item", id)
    window.history.replaceState(null, "", url)
  }, [])
  const close = React.useCallback((): void => {
    setItemId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete("item")
    window.history.replaceState(null, "", url)
  }, [])
  return [itemId, open, close] as const
}
