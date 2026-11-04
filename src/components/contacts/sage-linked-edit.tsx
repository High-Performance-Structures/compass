"use client"

import * as React from "react"
import { toast } from "sonner"

import { requestSageContactRefresh, reviewSageContactChange } from "@/app/actions/sage-contact-changes"
import {
  getSageLinkedEditState,
  retrySageLinkedChange,
  type SageEditOutcomeItem,
  type SageLinkedEditState,
  type SagePendingChange,
} from "@/app/actions/sage-linked-edits"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * Shared pieces of the inline Sage-linked edit forms (vendors, clients and
 * their Sage people): the edit state, per-field markers, and the save outcome
 * messages. Compass shows a saved value at once; Sage-shared fields also go
 * to Sage as a reviewed change request, marked "Sage update pending" until
 * Sage has the value.
 */

const SAGE_PENDING_LABEL = "Sage update pending"

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
  // Editing again replaces a waiting request; only a write in progress locks the record.
  if (state.pending[entityId]?.status === "running") return SAGE_WRITING_REASON
  return null
}

const SAGE_WRITING_REASON = "Sage is writing the last change now. Try again in a minute."

/** True when the field's value in Compass is still on its way to Sage. */
function isSagePendingField(pending: SagePendingChange | undefined, field: string): boolean {
  return Boolean(pending?.changes.some((item) => item.field === field))
}

/** The small "Sage update pending" marker beside a field. */
export function SagePendingMarker({ pending }: { readonly pending: SagePendingChange }): React.ReactElement {
  return pending.error ? (
    <Badge variant="destructive" title={pending.error}>Sage update failed</Badge>
  ) : (
    <Badge variant="secondary" title="Compass shows the new value; Sage gets it once the change is approved.">
      {SAGE_PENDING_LABEL}
    </Badge>
  )
}

/** The note under a Sage-shared field: its pending marker, or why it is locked. */
export function SageFieldNote({
  pending,
  field,
  lockedReason,
}: {
  readonly pending: SagePendingChange | undefined
  readonly field: string
  readonly lockedReason: string | null
}): React.ReactElement | null {
  if (lockedReason && lockedReason !== SAGE_WRITING_REASON) {
    return <p className="text-xs text-muted-foreground">{lockedReason}</p>
  }
  if (pending && isSagePendingField(pending, field)) return <SagePendingMarker pending={pending} />
  if (lockedReason) return <p className="text-xs text-muted-foreground">{lockedReason}</p>
  return null
}

/**
 * The record's line about its Sage change: waiting for approval, or (when the
 * write failed or did not read back) the error with Retry and Reject. A
 * rejection puts Sage's values back in Compass.
 */
export function SagePendingNotice({
  kind,
  entityId,
  pending,
  canEdit,
  onChanged,
}: {
  readonly kind: "client_company" | "vendor_company" | "client_person" | "vendor_person"
  readonly entityId: string
  readonly pending: SagePendingChange | undefined
  readonly canEdit: boolean
  readonly onChanged: () => void | Promise<void>
}): React.ReactElement | null {
  const [busy, setBusy] = React.useState(false)
  if (!pending) return null
  if (!pending.error) {
    return (
      <p className="text-xs text-muted-foreground">
        {SAGE_PENDING_LABEL}: Compass already shows the new values; Sage gets them once a different staff member approves.
      </p>
    )
  }
  const run = async (action: () => Promise<{ readonly success: boolean; readonly error?: string }>, done: string) => {
    setBusy(true)
    try {
      const result = await action()
      if (result.success) toast.success(done)
      else toast.error(result.error ?? "Could not update the Sage change")
      await onChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 text-xs">
      <p className="text-destructive">Sage update failed: {pending.error}</p>
      {canEdit ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
            const result = await retrySageLinkedChange(kind, entityId)
            if (result.success) announceSageOutcomes(result.data.sage)
            return result
          }, "Sage change sent again")}>
            Retry
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy}
            onClick={() => void run(() => reviewSageContactChange(pending.proposalId, "reject"), "Rejected; Compass shows the Sage value again")}>
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  )
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
        toast.success(`Saved ${label}. Sage update pending: it goes to Sage once approved.`)
        break
      case "updated":
        toast.success(`Saved ${label}. The waiting Sage change now asks for these values.`)
        break
      case "already_requested":
        toast.info(`${label}: this change is already waiting for Sage approval.`)
        break
      case "in_sage":
        toast.success(`${label}: Sage already has these values; Compass now matches Sage.`)
        break
      case "reading_sage":
        done = false
        toast.info(`Reading ${label} from Sage for the first time. Save again in a minute to change it.`)
        break
      case "blocked":
        done = false
        toast.error(`${label}: ${outcome.error}`)
        break
    }
  }
  return done
}
