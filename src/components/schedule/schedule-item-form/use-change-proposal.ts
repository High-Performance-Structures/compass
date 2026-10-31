"use client"

import { useEffect, useState } from "react"
import type { UseFormReturn } from "react-hook-form"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  getScheduleTaskChangeProposal,
  rejectScheduleTaskChangeProposal,
  sendScheduleTaskReminder,
  type ScheduleTaskChangeProposal,
} from "@/app/actions/schedule-confirmations"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import type { ScheduleItemFormValues } from "./form-model"

export interface ChangeProposalState {
  readonly changeProposal: ScheduleTaskChangeProposal | null
  readonly proposalLoading: boolean
  readonly proposalActionPending: boolean
  readonly acceptProposalOnSave: boolean
  readonly setAcceptProposalOnSave: (accept: boolean) => void
  readonly useProposedDates: () => void
  readonly rejectProposedDates: () => Promise<void>
  readonly sendingReminder: boolean
  readonly handleSendReminder: () => Promise<void>
}

/**
 * The assignee's pending date proposal for the item being edited, and the
 * confirmation reminder. Kept above the collapsible Details section so an
 * in-flight action survives collapsing it.
 */
export function useChangeProposal(
  open: boolean,
  editingTask: ScheduleTaskData | null,
  form: UseFormReturn<ScheduleItemFormValues>
): ChangeProposalState {
  const router = useRouter()
  const [changeProposal, setChangeProposal] =
    useState<ScheduleTaskChangeProposal | null>(null)
  const [proposalLoading, setProposalLoading] = useState(false)
  const [proposalActionPending, setProposalActionPending] = useState(false)
  const [acceptProposalOnSave, setAcceptProposalOnSave] = useState(false)
  const [sendingReminder, setSendingReminder] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!open || !editingTask) {
      setChangeProposal(null)
      setProposalLoading(false)
      return () => {
        cancelled = true
      }
    }

    setProposalLoading(true)
    void getScheduleTaskChangeProposal(editingTask.id)
      .then((proposal) => {
        if (!cancelled) setChangeProposal(proposal)
      })
      .catch((error: unknown) => {
        console.error("Unable to load schedule change proposal", error)
        if (!cancelled) toast.error("The subcontractor proposal could not be loaded.")
      })
      .finally(() => {
        if (!cancelled) setProposalLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [editingTask, open])

  function useProposedDates(): void {
    if (!changeProposal) return
    form.setValue("startDate", changeProposal.startDate, {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.setValue("workdays", changeProposal.workdays, {
      shouldDirty: true,
      shouldValidate: true,
    })
    setAcceptProposalOnSave(true)
    toast.info("Proposed dates loaded. Review them, then save the schedule item.")
  }

  async function rejectProposedDates(): Promise<void> {
    if (!editingTask || !changeProposal) return
    setProposalActionPending(true)
    const result = await rejectScheduleTaskChangeProposal(editingTask.id)
    setProposalActionPending(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setChangeProposal(null)
    setAcceptProposalOnSave(false)
    toast.success("The proposed dates were declined. The assignee can respond again.")
    router.refresh()
  }

  async function handleSendReminder(): Promise<void> {
    if (!editingTask) return
    setSendingReminder(true)
    const result = await sendScheduleTaskReminder(editingTask.id)
    setSendingReminder(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("Confirmation reminder sent.")
    router.refresh()
  }

  return {
    changeProposal,
    proposalLoading,
    proposalActionPending,
    acceptProposalOnSave,
    setAcceptProposalOnSave,
    useProposedDates,
    rejectProposedDates,
    sendingReminder,
    handleSendReminder,
  }
}
