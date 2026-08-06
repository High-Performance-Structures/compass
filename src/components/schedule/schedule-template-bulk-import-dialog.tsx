"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { IconLoader2, IconTemplate } from "@tabler/icons-react"
import { toast } from "sonner"

import { importScheduleTemplateItems } from "@/app/actions/schedule"
import type { ScheduleTemplateImportGroup } from "@/app/actions/template-import-options"
import {
  clearScheduleTemplateImportOptions,
  loadScheduleTemplateImportOptions
} from "@/components/schedule/schedule-template-import-options-client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"

type ScheduleTemplateBulkImportDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly projectId: string
}

function localDateValue(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function scheduleTimingLabel(input: {
  readonly selected: boolean
  readonly templateOffset: number
  readonly firstSelectedOffset: number | null
}): string {
  if (!input.selected || input.firstSelectedOffset === null) {
    return `template workday ${input.templateOffset + 1}`
  }
  const relativeOffset = input.templateOffset - input.firstSelectedOffset
  if (relativeOffset === 0) return "starts on the chosen date"
  return `starts ${relativeOffset} workdays after the first selected item`
}

export function ScheduleTemplateBulkImportDialog({
  open,
  onOpenChange,
  projectId
}: ScheduleTemplateBulkImportDialogProps) {
  const router = useRouter()
  const [templateGroups, setTemplateGroups] = useState<
    readonly ScheduleTemplateImportGroup[] | null
  >(null)
  const [templateId, setTemplateId] = useState("")
  const [anchorDate, setAnchorDate] = useState(localDateValue)
  const [selectedItemIds, setSelectedItemIds] = useState<readonly string[]>([])
  const [todoAssignments, setTodoAssignments] = useState<
    Readonly<Record<string, string>>
  >({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isImporting, startImporting] = useTransition()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    void loadScheduleTemplateImportOptions()
      .then((groups) => {
        if (!cancelled) setTemplateGroups(groups)
      })
      .catch((error: unknown) => {
        console.error("Unable to load schedule template options", error)
        if (!cancelled) {
          setTemplateGroups(null)
          setLoadError(true)
          toast.error("Unable to load published schedule templates.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadAttempt, open])

  useEffect(() => {
    if (open) return
    setTemplateId("")
    setSelectedItemIds([])
    setTodoAssignments({})
  }, [open])

  const selectedGroup = useMemo(
    () => templateGroups?.find((group) => group.templateId === templateId) ?? null,
    [templateGroups, templateId]
  )
  const selectedItemIdSet = useMemo(
    () => new Set(selectedItemIds),
    [selectedItemIds]
  )
  const selectedItems = useMemo(
    () =>
      (selectedGroup?.scheduleItems ?? []).filter((item) =>
        selectedItemIdSet.has(item.id)
      ),
    [selectedGroup, selectedItemIdSet]
  )
  const firstSelectedOffset = useMemo(
    () =>
      selectedItems.length === 0
        ? null
        : Math.min(...selectedItems.map((item) => item.startOffsetWorkdays)),
    [selectedItems]
  )

  function chooseTemplate(nextTemplateId: string): void {
    setTemplateId(nextTemplateId)
    setSelectedItemIds([])
    setTodoAssignments({})
  }

  function toggleScheduleItem(itemId: string, selected: boolean): void {
    setSelectedItemIds((current) =>
      selected
        ? current.includes(itemId)
          ? current
          : [...current, itemId]
        : current.filter((id) => id !== itemId)
    )
    if (!selected) {
      setTodoAssignments((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, assignedItemId]) => assignedItemId !== itemId)
        )
      )
    }
  }

  function toggleTodo(todoId: string, selected: boolean): void {
    if (selected) {
      const firstItemId = selectedItems[0]?.id
      if (!firstItemId) return
      setTodoAssignments((current) => ({ ...current, [todoId]: firstItemId }))
      return
    }
    setTodoAssignments((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== todoId))
    )
  }

  function assignTodo(todoId: string, scheduleItemId: string): void {
    if (!selectedItemIdSet.has(scheduleItemId)) return
    setTodoAssignments((current) => ({
      ...current,
      [todoId]: scheduleItemId
    }))
  }

  function handleImport(): void {
    if (!selectedGroup || selectedItems.length === 0 || !anchorDate) return
    startImporting(async () => {
      const result = await importScheduleTemplateItems(projectId, {
        templateId: selectedGroup.templateId,
        anchorDate,
        selections: selectedItems.map((item) => ({
          templateItemId: item.id,
          templateTodoIds: Object.entries(todoAssignments).flatMap(
            ([todoId, assignedItemId]) => assignedItemId === item.id ? [todoId] : []
          )
        }))
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        `Imported ${result.scheduleItemCount} schedule item${
          result.scheduleItemCount === 1 ? "" : "s"
        }, ${result.dependencyCount} dependenc${
          result.dependencyCount === 1 ? "y" : "ies"
        }, and ${result.linkedTodoCount} linked to-do${
          result.linkedTodoCount === 1 ? "" : "s"
        }.`
      )
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5">
          <DialogTitle>Import schedule items from a template</DialogTitle>
          <DialogDescription>
            Choose only the items this project needs. Dates retain their template spacing,
            dependencies are preserved between selected items, and optional to-dos can be
            assigned to one selected schedule item.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              <IconLoader2 className="mr-2 size-4 animate-spin" />
              Loading published templates…
            </div>
          ) : loadError ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <p>Compass could not load the published templates.</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  clearScheduleTemplateImportOptions()
                  setLoadError(false)
                  setTemplateGroups(null)
                  setLoadAttempt((attempt) => attempt + 1)
                }}
              >
                Retry
              </Button>
            </div>
          ) : templateGroups?.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
              <IconTemplate className="size-5" />
              No published templates contain reusable schedule items.
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bulk-schedule-template">Template</Label>
                  <Select value={templateId} onValueChange={chooseTemplate}>
                    <SelectTrigger id="bulk-schedule-template">
                      <SelectValue placeholder="Choose a published template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templateGroups?.map((group) => (
                        <SelectItem key={group.templateId} value={group.templateId}>
                          {group.templateName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bulk-template-anchor-date">First-item start date</Label>
                  <Input
                    id="bulk-template-anchor-date"
                    type="date"
                    value={anchorDate}
                    onChange={(event) => setAnchorDate(event.currentTarget.value)}
                  />
                </div>
              </div>

              {selectedGroup && (
                <section className="border-y py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Schedule items</h3>
                      <p className="text-xs text-muted-foreground">
                        {selectedItemIds.length} of {selectedGroup.scheduleItems.length} selected
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSelectedItemIds(
                            selectedGroup.scheduleItems.map((item) => item.id)
                          )
                        }
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={selectedItemIds.length === 0}
                        onClick={() => {
                          setSelectedItemIds([])
                          setTodoAssignments({})
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-72 divide-y overflow-y-auto border-y">
                    {selectedGroup.scheduleItems.map((item) => (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-start gap-3 py-3"
                      >
                        <Checkbox
                          checked={selectedItemIdSet.has(item.id)}
                          onCheckedChange={(value) =>
                            toggleScheduleItem(item.id, value === true)
                          }
                          aria-label={`Import ${item.title}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{item.title}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {item.phase} · {item.workdays} workday
                            {item.workdays === 1 ? "" : "s"} · {scheduleTimingLabel({
                              selected: selectedItemIdSet.has(item.id),
                              templateOffset: item.startOffsetWorkdays,
                              firstSelectedOffset
                            })}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {selectedGroup && selectedItems.length > 0 && selectedGroup.linkedTodos.length > 0 && (
                <section>
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">Optional template to-dos</h3>
                    <p className="text-xs text-muted-foreground">
                      Select only what this project needs, then choose the schedule item each
                      to-do belongs to.
                    </p>
                  </div>
                  <div className="max-h-72 divide-y overflow-y-auto border-y">
                    {selectedGroup.linkedTodos.map((todo) => {
                      const assignedItemId = todoAssignments[todo.id]
                      return (
                        <div key={todo.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_16rem]">
                          <label className="flex cursor-pointer items-start gap-3">
                            <Checkbox
                              checked={Boolean(assignedItemId)}
                              onCheckedChange={(value) => toggleTodo(todo.id, value === true)}
                              aria-label={`Include ${todo.title}`}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{todo.title}</span>
                              {todo.checklistItemCount > 0 && (
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  Includes {todo.checklistItemCount} checklist item
                                  {todo.checklistItemCount === 1 ? "" : "s"}
                                </span>
                              )}
                            </span>
                          </label>
                          {assignedItemId && (
                            <Select
                              value={assignedItemId}
                              onValueChange={(value) => assignTodo(todo.id, value)}
                            >
                              <SelectTrigger aria-label={`Schedule item for ${todo.title}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {selectedItems.map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {item.title}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedGroup || selectedItems.length === 0 || !anchorDate || isImporting}
            onClick={handleImport}
          >
            {isImporting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
            Import {selectedItems.length || "selected"} item
            {selectedItems.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
