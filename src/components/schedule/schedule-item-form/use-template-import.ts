"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { UseFormReturn } from "react-hook-form"
import { toast } from "sonner"
import type { ScheduleTemplateImportGroup } from "@/app/actions/template-import-options"
import { DEFAULT_DISPLAY_COLOR } from "@/lib/schedule/appearance"
import { DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS } from "@/components/schedule/schedule-item-defaults"
import {
  clearScheduleTemplateImportOptions,
  loadScheduleTemplateImportOptions
} from "@/components/schedule/schedule-template-import-options-client"
import { toggleSelectedId, type ScheduleItemFormValues } from "./form-model"

export interface TemplateImportState {
  readonly templateGroups: readonly ScheduleTemplateImportGroup[] | null
  readonly templateLoading: boolean
  readonly templateLoadError: boolean
  readonly selectedTemplateId: string
  readonly selectedTemplateItemId: string
  readonly selectedTemplateTodoIds: readonly string[]
  readonly templateTodosOpen: boolean
  readonly selectedTemplateGroup: ScheduleTemplateImportGroup | null
  readonly setTemplateTodosOpen: (open: boolean) => void
  readonly setSelectedTemplateTodoIds: (ids: readonly string[]) => void
  readonly chooseTemplate: (templateId: string) => void
  readonly applyTemplateScheduleItem: (templateItemId: string) => void
  readonly toggleTemplateTodo: (todoId: string, selected: boolean) => void
  readonly retryTemplateLoad: () => void
  readonly resetTemplateSelection: () => void
}

/** Published-template picker state for a new schedule item. */
export function useTemplateImport(
  open: boolean,
  isEditing: boolean,
  form: UseFormReturn<ScheduleItemFormValues>
): TemplateImportState {
  const [templateGroups, setTemplateGroups] = useState<
    readonly ScheduleTemplateImportGroup[] | null
  >(null)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateLoadError, setTemplateLoadError] = useState(false)
  const [templateLoadAttempt, setTemplateLoadAttempt] = useState(0)
  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const [selectedTemplateItemId, setSelectedTemplateItemId] = useState("")
  const [selectedTemplateTodoIds, setSelectedTemplateTodoIds] = useState<readonly string[]>([])
  const [templateTodosOpen, setTemplateTodosOpen] = useState(false)

  useEffect(() => {
    if (!open || isEditing || templateGroups !== null) return
    let cancelled = false
    setTemplateLoading(true)
    setTemplateLoadError(false)
    void loadScheduleTemplateImportOptions()
      .then((groups) => {
        if (!cancelled) setTemplateGroups(groups)
      })
      .catch((error: unknown) => {
        console.error("Unable to load schedule template options", error)
        if (!cancelled) {
          setTemplateGroups(null)
          setTemplateLoadError(true)
          toast.error("Unable to load published schedule templates.")
        }
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isEditing, open, templateGroups, templateLoadAttempt])

  const selectedTemplateGroup = useMemo(
    () => templateGroups?.find((group) => group.templateId === selectedTemplateId) ?? null,
    [selectedTemplateId, templateGroups]
  )

  function applyTemplateScheduleItem(templateItemId: string): void {
    setSelectedTemplateItemId(templateItemId)
    setSelectedTemplateTodoIds([])
    setTemplateTodosOpen(false)
    const item = selectedTemplateGroup?.scheduleItems.find(
      (candidate) => candidate.id === templateItemId
    )
    if (!item) return
    form.setValue("title", item.title, { shouldDirty: true })
    form.setValue("workdays", item.workdays, { shouldDirty: true })
    form.setValue("phase", item.phase, { shouldDirty: true })
    form.setValue("displayColor", item.displayColor, { shouldDirty: true })
    form.setValue("isMilestone", item.isMilestone, { shouldDirty: true })
    form.setValue(
      "assignees",
      item.assignedTo?.trim() ? [{ name: item.assignedTo.trim(), optionId: null }] : [],
      { shouldDirty: true }
    )
    form.setValue("ownerVisible", item.ownerVisible, { shouldDirty: true })
    form.setValue("subVendorVisible", item.subVendorVisible, {
      shouldDirty: true
    })
  }

  function chooseTemplate(templateId: string): void {
    setSelectedTemplateId(templateId)
    setSelectedTemplateItemId("")
    setSelectedTemplateTodoIds([])
    setTemplateTodosOpen(false)
    form.setValue("title", "", { shouldDirty: true })
    form.setValue("workdays", DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS, { shouldDirty: true })
    form.setValue("phase", "preconstruction", { shouldDirty: true })
    form.setValue("displayColor", DEFAULT_DISPLAY_COLOR, {
      shouldDirty: true
    })
    form.setValue("isMilestone", false, { shouldDirty: true })
    form.setValue("assignees", [], { shouldDirty: true })
    form.setValue("ownerVisible", true, { shouldDirty: true })
    form.setValue("subVendorVisible", false, { shouldDirty: true })
  }

  function toggleTemplateTodo(todoId: string, selected: boolean): void {
    setSelectedTemplateTodoIds((current) => toggleSelectedId(current, todoId, selected))
  }

  function retryTemplateLoad(): void {
    clearScheduleTemplateImportOptions()
    setTemplateLoadError(false)
    setTemplateGroups(null)
    setTemplateLoadAttempt((attempt) => attempt + 1)
  }

  // Stable so the dialog's open/reset effect can depend on it.
  const resetTemplateSelection = useCallback((): void => {
    setSelectedTemplateId("")
    setSelectedTemplateItemId("")
    setSelectedTemplateTodoIds([])
    setTemplateTodosOpen(false)
  }, [])

  return {
    templateGroups,
    templateLoading,
    templateLoadError,
    selectedTemplateId,
    selectedTemplateItemId,
    selectedTemplateTodoIds,
    templateTodosOpen,
    selectedTemplateGroup,
    setTemplateTodosOpen,
    setSelectedTemplateTodoIds,
    chooseTemplate,
    applyTemplateScheduleItem,
    toggleTemplateTodo,
    retryTemplateLoad,
    resetTemplateSelection,
  }
}
