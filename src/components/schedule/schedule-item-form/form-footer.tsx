"use client"

import { Button } from "@/components/ui/button"
import { IconTrash } from "@tabler/icons-react"
import type { TemplateImportState } from "./use-template-import"

/** Delete, the template summary, Cancel and Save or Create. */
export function ScheduleItemFormFooter({
  isEditing,
  template,
  setConfirmDeleteOpen,
  onOpenChange,
}: {
  readonly isEditing: boolean
  readonly template: TemplateImportState
  readonly setConfirmDeleteOpen: (open: boolean) => void
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t shrink-0">
      {isEditing ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmDeleteOpen(true)}
        >
          <IconTrash className="size-3.5" />
          Delete schedule item
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {!isEditing && template.selectedTemplateItemId
          ? `1 schedule item + ${template.selectedTemplateTodoIds.length} to-do${
              template.selectedTemplateTodoIds.length === 1 ? "" : "s"
            }`
          : null}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm">
          {isEditing ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  )
}
