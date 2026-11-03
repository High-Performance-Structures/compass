"use client"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { IconDeviceFloppy, IconBookmark, IconTrash } from "@tabler/icons-react"
import type { SavedScheduleViewData } from "@/lib/schedule/saved-views"
import type { SavedScheduleViewsState } from "./use-saved-schedule-views"

/** Saved views list with Save current and delete for the owner. */
export function ScheduleSavedViewsPopover({
  savedViewsState,
  applySavedView,
}: {
  readonly savedViewsState: SavedScheduleViewsState
  readonly applySavedView: (savedView: SavedScheduleViewData) => void
}) {
  const { savedViews, setSaveViewOpen, isSavingView, handleDeleteView } = savedViewsState
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          <IconBookmark className="size-3.5" />
          Views
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex items-center justify-between px-2 py-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Saved views
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setSaveViewOpen(true)}
          >
            <IconDeviceFloppy className="size-3.5" />
            Save current
          </Button>
        </div>
        <div className="mt-1 max-h-64 overflow-y-auto">
          {savedViews.map((savedView) => (
            <div
              key={savedView.id}
              className="flex items-center gap-1 hover:bg-muted"
            >
              <button
                type="button"
                className="min-w-0 flex-1 px-2 py-2 text-left text-sm"
                onClick={() => applySavedView(savedView)}
              >
                <span className="block truncate">{savedView.name}</span>
                <span className="text-xs capitalize text-muted-foreground">
                  {savedView.visibility}
                </span>
              </button>
              {savedView.isOwner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={isSavingView}
                  onClick={() => handleDeleteView(savedView)}
                  aria-label={`Delete ${savedView.name}`}
                >
                  <IconTrash className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
          {savedViews.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              Save a personal view or share one with the team.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
