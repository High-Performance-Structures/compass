"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import type { Table } from "@tanstack/react-table"
import { changeProjectTodos } from "@/app/actions/project-todos"
import type { ProjectTodoItem } from "@/lib/domain/operations/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Mode = "archive" | "restore" | "delete"
const labels: Readonly<Record<Mode, string>> = {
  archive: "Archive",
  restore: "Restore",
  delete: "Permanently delete",
}

export function ProjectTodoBulkActions({
  projectId,
  table,
  canDelete,
}: {
  readonly projectId: string
  readonly table: Table<ProjectTodoItem>
  readonly canDelete: boolean
}): React.ReactElement | null {
  const router = useRouter()
  const selected = table.getSelectedRowModel().rows.map((row) => row.original)
  const [mode, setMode] = React.useState<Mode | null>(null)
  const [snapshot, setSnapshot] = React.useState<readonly ProjectTodoItem[]>([])
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  function confirm(next: Mode): void {
    setSnapshot(selected)
    setError(null)
    setNotice(null)
    setMode(next)
  }
  function submit(): void {
    if (!mode || pending) return
    const action = mode
    startTransition(async () => {
      try {
        const result = await changeProjectTodos(projectId, {
          mode: action,
          selection: snapshot.map((item) => ({ id: item.id, updatedAt: item.updatedAt })),
        })
        if (!result.success) {
          setError(result.error)
          return
        }
        const changed = new Set(result.data.changedIds)
        table.setRowSelection((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => !changed.has(id))),
        )
        setNotice(
          `${changed.size} to-do${changed.size === 1 ? "" : "s"} ${action === "delete" ? "deleted" : action === "restore" ? "restored" : "archived"}.${result.data.skippedCount ? ` ${result.data.skippedCount} changed elsewhere and were left untouched. Refresh and review them.` : ""}`,
        )
        setMode(null)
        router.refresh()
      } catch {
        setError(
          "The request could not be completed. Refresh and review the selected records before trying again.",
        )
      }
    })
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Selected to-do actions"
        >
          <span className="text-sm" role="status">
            {selected.length} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => table.resetRowSelection()}
          >
            Clear selection
          </Button>
          {selected.every((item) => item.actions.canEdit) && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => confirm("archive")}
            >
              Archive selected
            </Button>
          )}
          {selected.every((item) => item.actions.canRestore) && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => confirm("restore")}
              >
                Restore selected
              </Button>
              {canDelete && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() => confirm("delete")}
                >
                  Delete selected
                </Button>
              )}
            </>
          )}
          {!selected.every((item) => item.actions.canEdit) &&
            !selected.every((item) => item.actions.canRestore) && (
              <span className="text-sm text-muted-foreground">
                Select active or archived to-dos separately.
              </span>
            )}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setMode(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode ? labels[mode] : "Change"} {snapshot.length} to-do
              {snapshot.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              {mode === "delete"
                ? "These archived to-dos and their to-do history will be permanently deleted. This cannot be undone. Linked schedule items and daily logs will remain."
                : mode === "restore"
                  ? "Return the selected archived to-dos to Open."
                  : "Remove the selected to-dos from active lists. You can restore them from Archived. Linked schedule items and daily logs will remain."}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {snapshot.map((item) => (
              <li key={item.id} className="break-words">
                {item.title}
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              variant={mode === "delete" ? "destructive" : "default"}
              disabled={pending}
              onClick={submit}
            >
              {pending ? "Saving…" : mode ? `${labels[mode]} selected` : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
