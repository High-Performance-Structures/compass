"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { IconLoader2, IconDeviceFloppy } from "@tabler/icons-react"
import type { SavedScheduleViewsState } from "./use-saved-schedule-views"

/** Names the current view and optionally shares it with staff. */
export function SaveScheduleViewDialog({
  savedViewsState,
}: {
  readonly savedViewsState: SavedScheduleViewsState
}) {
  const {
    saveViewOpen,
    setSaveViewOpen,
    saveViewName,
    setSaveViewName,
    saveViewShared,
    setSaveViewShared,
    isSavingView,
    handleSaveView,
  } = savedViewsState
  return (
    <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save schedule view</DialogTitle>
          <DialogDescription>
            Save the current scope, filters, grouping, ordering, and columns.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="schedule-view-name">View name</Label>
            <Input
              id="schedule-view-name"
              value={saveViewName}
              onChange={(event) => setSaveViewName(event.target.value)}
              placeholder="Example: Wes · next 30 days"
              className="mt-1.5"
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={saveViewShared}
              onCheckedChange={(checked) =>
                setSaveViewShared(checked === true)
              }
            />
            <span>
              Share with internal staff
              <span className="block text-xs text-muted-foreground">
                Personal views are visible only to you.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setSaveViewOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveView}
              disabled={!saveViewName.trim() || isSavingView}
            >
              {isSavingView ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconDeviceFloppy className="size-4" />
              )}
              Save view
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
