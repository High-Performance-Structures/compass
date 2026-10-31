"use client"

import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { format, parseISO } from "date-fns"
import { createTask, updateTask } from "@/app/actions/schedule"
import { calculateEndDate, workdaysFromEndDate } from "@/lib/schedule/business-days"
import { resolveScheduleShiftReason } from "@/lib/schedule/shift-tracking"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData
} from "@/lib/schedule/types"
import { useScheduleDisplayPalette } from "@/hooks/use-schedule-display-palette"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import {
  editingTaskValues,
  matchingAssigneeOptionId,
  newScheduleItemValues,
  scheduleItemSchema,
  scheduleShiftRequested,
  type ScheduleItemFormValues,
} from "./schedule-item-form/form-model"
import { useTemplateImport } from "./schedule-item-form/use-template-import"
import { usePhaseOptions } from "./schedule-item-form/use-phase-options"
import { useRecentColors } from "./schedule-item-form/use-recent-colors"
import { useChangeProposal } from "./schedule-item-form/use-change-proposal"
import { usePredecessorEdits } from "./schedule-item-form/use-predecessor-edits"
import { savePredecessorChanges } from "./schedule-item-form/save-predecessors"
import { TemplateImportSection } from "./schedule-item-form/template-import-section"
import { PhaseField } from "./schedule-item-form/phase-field"
import { DisplayColorFields } from "./schedule-item-form/display-color-fields"
import { ScheduleDateFields } from "./schedule-item-form/schedule-date-fields"
import { ScheduleItemDetails } from "./schedule-item-form/schedule-item-details"
import { RelatedTodosSection } from "./schedule-item-form/related-todos-section"
import { DeleteScheduleItemDialog } from "./schedule-item-form/delete-schedule-item-dialog"
import { ScheduleItemFormFooter } from "./schedule-item-form/form-footer"
import { ShiftReasonField } from "./schedule-item-form/shift-reason-field"

interface ScheduleItemFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  editingTask: ScheduleTaskData | null
  allTasks?: readonly ScheduleTaskData[]
  dependencies?: readonly TaskDependencyData[]
  exceptions?: readonly WorkdayExceptionData[]
  assigneeOptions?: readonly ProjectTaskAssigneeOption[]
  onBulkTemplateImport?: () => void
  /** False until the schedule is first published; drafts need no shift reason. */
  shiftReasonRequired?: boolean
  /** Called after the item being edited is deleted from this dialog. */
  onDeleted?: (taskId: string) => void
}

export function ScheduleItemFormDialog({
  open,
  onOpenChange,
  projectId,
  editingTask,
  allTasks = [],
  dependencies = [],
  exceptions = [],
  assigneeOptions = [],
  onBulkTemplateImport,
  shiftReasonRequired = true,
  onDeleted,
}: ScheduleItemFormDialogProps) {
  const router = useRouter()
  const isEditing = !!editingTask
  const displayColorPalette = useScheduleDisplayPalette(projectId)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [assignedOptionId, setAssignedOptionId] = useState<string | null>(null)
  const [endDateNote, setEndDateNote] = useState<string | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const form = useForm<ScheduleItemFormValues>({
    resolver: zodResolver(scheduleItemSchema),
    defaultValues: newScheduleItemValues()
  })

  const template = useTemplateImport(open, isEditing, form, setAssignedOptionId)
  const phase = usePhaseOptions(open, projectId)
  const { recentColors, rememberColor } = useRecentColors(open)
  const predecessors = usePredecessorEdits(projectId, editingTask, allTasks, dependencies)
  const proposalState = useChangeProposal(open, editingTask, form)
  const { resetTemplateSelection } = template
  const { resetCustomPhase } = phase
  const { setPendingPredecessors } = predecessors
  const { setAcceptProposalOnSave } = proposalState

  useEffect(() => {
    if (!open) return
    setEndDateNote(null)
    if (editingTask) {
      form.reset(editingTaskValues(editingTask))
      setAssignedOptionId(matchingAssigneeOptionId(assigneeOptions, editingTask.assignedTo))
      // expand details when editing since they likely want to see everything
      setDetailsOpen(true)
    } else {
      form.reset(newScheduleItemValues())
      setAssignedOptionId(null)
      setDetailsOpen(false)
      resetTemplateSelection()
    }
    resetCustomPhase()
    setPendingPredecessors([])
    setAcceptProposalOnSave(false)
  }, [
    assigneeOptions,
    editingTask,
    form,
    open,
    resetCustomPhase,
    resetTemplateSelection,
    setAcceptProposalOnSave,
    setPendingPredecessors,
  ])

  const watchedStart = form.watch("startDate")
  const watchedWorkdays = form.watch("workdays")

  // Picking an end date sets the duration from the same workday calendar
  // that calculates the end, so the two always agree.
  function chooseEndDate(endDate: string): void {
    const result = workdaysFromEndDate(watchedStart, endDate, exceptions)
    if (!result.success) {
      setEndDateNote(result.error)
      return
    }
    form.setValue("workdays", result.workdays, { shouldDirty: true, shouldValidate: true })
    setEndDateNote(
      result.snapped
        ? `${format(parseISO(endDate), "MMM d")} isn't a workday, so the item ends ${format(parseISO(result.endDate), "EEE, MMM d")}.`
        : null
    )
  }

  const calculatedEnd = useMemo(() => {
    if (!watchedStart || !watchedWorkdays || watchedWorkdays < 1) return ""
    return calculateEndDate(watchedStart, watchedWorkdays, exceptions)
  }, [exceptions, watchedStart, watchedWorkdays])

  async function onSubmit(values: ScheduleItemFormValues) {
    const shiftReasonResult = resolveScheduleShiftReason(
      shiftReasonRequired &&
        scheduleShiftRequested({
          editingTask,
          values,
          existingPredecessors: predecessors.existingPredecessors,
          existingPredecessorEdits: predecessors.existingPredecessorEdits,
          pendingPredecessors: predecessors.pendingPredecessors,
        }),
      values.shiftReason
    )
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      form.setError("shiftReason", { message: shiftReasonResult.error })
      return
    }

    const submittedPhase = await phase.submittedPhase(values.phase)
    if (submittedPhase === null) return
    rememberColor(values.displayColor)
    const { shiftReason, ...valuesWithoutShiftReason } = values
    const taskValues = {
      ...valuesWithoutShiftReason,
      startTime: values.startTime || null,
      endTime: values.startTime ? values.endTime || null : null,
      phase: submittedPhase,
      notes: values.notes.trim() || null
    }
    void shiftReason
    let savedTaskId: string
    let linkedTodoCount = 0
    if (isEditing) {
      const result = await updateTask(editingTask.id, {
        ...taskValues,
        assignedTo: taskValues.assignedTo || null,
        assignedOptionId,
        acceptChangeProposal: proposalState.acceptProposalOnSave,
        shiftReason: shiftReasonResult?.success
          ? shiftReasonResult.reason
          : undefined
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      savedTaskId = editingTask.id
    } else {
      const result = await createTask(projectId, {
        ...taskValues,
        assignedTo: taskValues.assignedTo || undefined,
        assignedOptionId,
        templateScheduleItemId: template.selectedTemplateItemId || null,
        templateTodoIds: template.selectedTemplateTodoIds
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      savedTaskId = result.taskId
      linkedTodoCount = result.linkedTodoCount
    }

    const dependencyErrors = await savePredecessorChanges({
      projectId,
      savedTaskId,
      shiftReason: shiftReasonResult?.success
        ? shiftReasonResult.reason
        : values.shiftReason,
      existingPredecessors: predecessors.existingPredecessors,
      existingPredecessorEdits: predecessors.existingPredecessorEdits,
      pendingPredecessors: predecessors.pendingPredecessors,
    })

    router.refresh()
    if (dependencyErrors.length > 0) {
      toast.warning(
        `Schedule item saved, but ${dependencyErrors.length} predecessor change${
          dependencyErrors.length === 1 ? "" : "s"
        } could not be saved: ${dependencyErrors.join("; ")}`
      )
      return
    }
    if (linkedTodoCount > 0) {
      toast.success(
        `Schedule item created with ${linkedTodoCount} linked to-do${
          linkedTodoCount === 1 ? "" : "s"
        }.`
      )
    }
    onOpenChange(false)
  }

  const hasPredecessors =
    predecessors.existingPredecessors.length > 0 || predecessors.pendingPredecessors.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-5 pt-4 pb-3 shrink-0">
          <DialogTitle className="text-base font-semibold">
            {isEditing ? "Edit Schedule Item" : "New Schedule Item"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
            <div className="overflow-y-auto flex-1 min-h-0 px-5 pb-4 space-y-4">
              {/* === ESSENTIAL FIELDS === */}

              {!isEditing && (
                <TemplateImportSection
                  template={template}
                  onBulkTemplateImport={onBulkTemplateImport}
                />
              )}

              {/* Title */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        placeholder="Schedule item name"
                        className="h-10 text-sm font-medium border-0 border-b rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <PhaseField form={form} phase={phase} />

              <DisplayColorFields
                form={form}
                displayColorPalette={displayColorPalette}
                recentColors={recentColors}
              />

              <ScheduleDateFields
                form={form}
                calculatedEnd={calculatedEnd}
                endDateNote={endDateNote}
                setEndDateNote={setEndDateNote}
                chooseEndDate={chooseEndDate}
              />

              {shiftReasonRequired && <ShiftReasonField form={form} />}

              <ScheduleItemDetails
                form={form}
                open={open}
                detailsOpen={detailsOpen}
                setDetailsOpen={setDetailsOpen}
                editingTask={editingTask}
                hasPredecessors={hasPredecessors}
                assigneeOptions={assigneeOptions}
                setAssignedOptionId={setAssignedOptionId}
                proposalState={proposalState}
                predecessors={predecessors}
              />

              {editingTask && (
                <RelatedTodosSection
                  open={open}
                  projectId={projectId}
                  editingTask={editingTask}
                  assigneeOptions={assigneeOptions}
                />
              )}
            </div>

            {/* Footer */}
            <ScheduleItemFormFooter
              isEditing={isEditing}
              template={template}
              setConfirmDeleteOpen={setConfirmDeleteOpen}
              onOpenChange={onOpenChange}
            />
          </form>
        </Form>
      </DialogContent>
      <DeleteScheduleItemDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        editingTask={editingTask}
        onDeletedItem={(taskId) => {
          onOpenChange(false)
          onDeleted?.(taskId)
        }}
      />
    </Dialog>
  )
}
