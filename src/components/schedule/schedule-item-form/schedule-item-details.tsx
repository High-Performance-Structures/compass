"use client"

import type { UseFormReturn } from "react-hook-form"
import { toast } from "sonner"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel
} from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { ScheduleCommitmentResponses } from "@/components/schedule/schedule-commitment-responses"
import { ScheduleItemLinks } from "@/components/schedule/schedule-item-links"
import type { ScheduleItemFormValues } from "./form-model"
import type { ChangeProposalState } from "./use-change-proposal"
import type { PredecessorEditsState } from "./use-predecessor-edits"
import { StatusProgressFields } from "./status-progress-fields"
import { AudienceCommitmentSection } from "./audience-commitment-section"
import { PredecessorsEditor } from "./predecessors-editor"

/** The collapsible Details section of the schedule item form. */
export function ScheduleItemDetails({
  form,
  open,
  detailsOpen,
  setDetailsOpen,
  editingTask,
  hasPredecessors,
  assigneeOptions,
  setAssignedOptionId,
  proposalState,
  predecessors,
}: {
  readonly form: UseFormReturn<ScheduleItemFormValues>
  readonly open: boolean
  readonly detailsOpen: boolean
  readonly setDetailsOpen: (open: boolean) => void
  readonly editingTask: ScheduleTaskData | null
  readonly hasPredecessors: boolean
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly setAssignedOptionId: (id: string | null) => void
  readonly proposalState: ChangeProposalState
  readonly predecessors: PredecessorEditsState
}) {
  const isEditing = !!editingTask
  return (
    <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1 w-full"
        >
          {detailsOpen ? (
            <IconChevronDown className="size-3.5" />
          ) : (
            <IconChevronRight className="size-3.5" />
          )}
          Details
          {!detailsOpen && (isEditing || hasPredecessors) && (
            <span className="text-xs text-primary ml-1">(has data)</span>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 pt-3">
        <StatusProgressFields
          form={form}
          assigneeOptions={assigneeOptions}
          setAssignedOptionId={setAssignedOptionId}
        />

        <AudienceCommitmentSection
          form={form}
          editingTask={editingTask}
          proposal={proposalState}
        />

        {isEditing && open && (
          <ScheduleCommitmentResponses
            taskId={editingTask.id}
            onUseProposal={(proposal) => {
              if (proposal.startDate !== null) {
                form.setValue("startDate", proposal.startDate, { shouldDirty: true, shouldValidate: true })
              }
              if (proposal.workdays !== null) {
                form.setValue("workdays", proposal.workdays, { shouldDirty: true, shouldValidate: true })
              }
              toast.info("Proposed dates loaded. Review and save, then publish the schedule.")
            }}
          />
        )}

        {isEditing && <ScheduleItemLinks taskId={editingTask.id} />}

        <PredecessorsEditor predecessors={predecessors} />

        {/* Notes */}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground font-medium">
                Notes
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Add notes..."
                  className="min-h-[60px] resize-none text-sm"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}
