"use client"

import type { UseFormReturn } from "react-hook-form"
import { format, parseISO } from "date-fns"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel
} from "@/components/ui/form"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import { confirmationStatusLabel, type ScheduleItemFormValues } from "./form-model"
import type { ChangeProposalState } from "./use-change-proposal"

/** Who can see the item, commitment requests and the assignee's proposal. */
export function AudienceCommitmentSection({
  form,
  editingTask,
  proposal,
}: {
  readonly form: UseFormReturn<ScheduleItemFormValues>
  readonly editingTask: ScheduleTaskData | null
  readonly proposal: ChangeProposalState
}) {
  const isEditing = !!editingTask
  const {
    changeProposal,
    proposalLoading,
    proposalActionPending,
    acceptProposalOnSave,
    useProposedDates,
    rejectProposedDates,
    sendingReminder,
    handleSendReminder,
  } = proposal

  return (
    <div className="border-t pt-4">
      <p className="text-xs font-medium">Audience &amp; commitment</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Visibility changes reach project workspaces only after the schedule is
        published.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <FormField
          control={form.control}
          name="ownerVisible"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
              <FormLabel className="!mt-0 text-xs">Owner can view</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="subVendorVisible"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
              <FormLabel className="!mt-0 text-xs">Subs can view</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmationRequired"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3 border px-3 py-2">
              <FormLabel className="!mt-0 text-xs">Require confirmation</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Assign owner-performed work or owner-supplied deliveries to the owner.
        Require confirmation and publish to request their commitment.
        Use a milestone for a delivery deadline.
      </p>
      {proposalLoading && (
        <p className="mt-3 border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
          Loading assignment proposal…
        </p>
      )}
      {changeProposal && (
        <div className="mt-3 space-y-3 border border-warning/50 bg-warning/5 px-3 py-3">
          <div>
            <p className="text-xs font-medium">
              Assignee proposed new dates
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {format(parseISO(changeProposal.startDate), "MMM d, yyyy")} ·{" "}
              {changeProposal.workdays} workday
              {changeProposal.workdays === 1 ? "" : "s"}
            </p>
            {changeProposal.note && (
              <p className="mt-2 whitespace-pre-wrap text-xs">
                {changeProposal.note}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={proposalActionPending}
              onClick={useProposedDates}
            >
              {acceptProposalOnSave ? "Proposal loaded" : "Use proposed dates"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={proposalActionPending}
              onClick={rejectProposedDates}
            >
              Decline proposal
            </Button>
          </div>
          {acceptProposalOnSave && (
            <p className="text-xs text-muted-foreground">
              Saving applies these dates through the normal dependency and
              related to-do updates. Publish afterward to make them visible
              externally.
            </p>
          )}
        </div>
      )}
      {isEditing && editingTask.confirmationRequired && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            Status:{" "}
            {confirmationStatusLabel(editingTask.confirmationStatus)}
          </span>
          {editingTask.proposalNote && editingTask.confirmationStatus !== "proposed" && (
            <p className="w-full whitespace-pre-wrap text-muted-foreground">
              Response note: {editingTask.proposalNote}
            </p>
          )}
          {editingTask.confirmationStatus !== "confirmed" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sendingReminder}
              onClick={handleSendReminder}
            >
              {sendingReminder ? "Sending…" : "Send reminder"}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
