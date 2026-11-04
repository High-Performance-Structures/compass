"use client"

import * as React from "react"
import { toast } from "sonner"

import { requestSageContactRefresh } from "@/app/actions/sage-contact-changes"
import {
  getSageLinkedEditState,
  type SageEditOutcomeItem,
  type SageLinkedEditState,
  type SagePendingChange,
} from "@/app/actions/sage-linked-edits"

/**
 * Shared pieces of the inline Sage-linked edit forms (vendors, clients and
 * their Sage people): the edit state, per-field notes, and the save outcome
 * messages. Sage-shared fields save as a reviewed Sage change request.
 */

export const SAGE_PENDING_LABEL = "Pending Sage approval"

/**
 * Loads the record's Sage edit state. When the company's last Sage read is
 * old, asks the Sage writer (it runs every minute) for a fresh one so a save
 * can be sent for approval.
 */
export function useSageLinkedEditState(
  kind: "client_company" | "vendor_company",
  entityId: string | null,
  canEdit: boolean
): { readonly state: SageLinkedEditState | null; readonly reload: () => Promise<void> } {
  const [state, setState] = React.useState<SageLinkedEditState | null>(null)
  const refreshAsked = React.useRef<string | null>(null)

  const reload = React.useCallback(async () => {
    if (!entityId) {
      setState(null)
      return
    }
    const result = await getSageLinkedEditState(kind, entityId)
    setState(result.success ? result.data : null)
    if (result.success && canEdit && result.data.verified && result.data.bridgeConfigured &&
      !result.data.fresh && refreshAsked.current !== entityId) {
      refreshAsked.current = entityId
      // Best effort: a read already queued for this record is fine.
      await requestSageContactRefresh(kind, entityId).catch(() => undefined)
    }
  }, [kind, entityId, canEdit])

  React.useEffect(() => { void reload() }, [reload])
  return { state, reload }
}

/** Why a Sage-shared field of one record cannot be edited now, or null. */
export function sageFieldLockedReason(
  state: SageLinkedEditState | null,
  entityId: string,
  field: string,
  options: { readonly company: boolean }
): string | null {
  if (!state) return "Loading Sage details…"
  if (!state.bridgeConfigured) return "Sage contact sync is not set up. Change this in Sage."
  if (!state.verified) return "Verify the Sage link first."
  if (options.company && state.unavailableFields.includes(field)) {
    return "The Sage writer on the Sage computer needs its update before this can change here."
  }
  if (state.pending[entityId]) return "Waiting on the Sage change already requested."
  return null
}

export function pendingValue(pending: SagePendingChange | undefined, field: string): string | null | undefined {
  const change = pending?.changes.find((item) => item.field === field)
  return change ? change.after : undefined
}

/** The note under a Sage-shared field: its pending value, or why it is locked. */
export function SageFieldNote({
  pending,
  field,
  lockedReason,
}: {
  readonly pending: SagePendingChange | undefined
  readonly field: string
  readonly lockedReason: string | null
}): React.ReactElement | null {
  const value = pendingValue(pending, field)
  if (value !== undefined) {
    return (
      <p className="text-xs text-muted-foreground">
        {SAGE_PENDING_LABEL}: <span className="font-medium text-foreground">{value ?? "(blank)"}</span>
      </p>
    )
  }
  if (lockedReason && lockedReason !== "Waiting on the Sage change already requested.") {
    return <p className="text-xs text-muted-foreground">{lockedReason}</p>
  }
  return null
}

/**
 * Toasts for each Sage change request a save produced. Returns true when
 * nothing is left for the person to do (the form may close).
 */
export function announceSageOutcomes(items: readonly SageEditOutcomeItem[]): boolean {
  let done = true
  for (const { label, outcome } of items) {
    switch (outcome.status) {
      case "requested":
        toast.success(`Sent for Sage approval: ${label}. Compass shows the new values once Sage confirms them.`)
        break
      case "already_requested":
        toast.info(`${label}: this change is already waiting for Sage approval.`)
        break
      case "in_sage":
        toast.success(`${label}: Sage already has these values; Compass now matches Sage.`)
        break
      case "reading_sage":
        done = false
        toast.info(`Reading ${label} from Sage. Save again in a minute to send the change for approval.`)
        break
      case "blocked":
        done = false
        toast.error(`${label}: ${outcome.error}`)
        break
    }
  }
  return done
}
