"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getSageContactEditorState,
  proposeSageContactChange,
  requestSageContactRefresh,
  type SageContactEditorState,
} from "@/app/actions/sage-contact-changes"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SageContactKind } from "@/lib/sage/contact-change-proposal"

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "Contact name", title: "Job title", ownerName: "Owner",
  addressLine1: "Address 1", addressLine2: "Address 2", city: "City",
  state: "State", postalCode: "ZIP code",
  billingAddressLine1: "Billing address 1", billingAddressLine2: "Billing address 2",
  billingCity: "Billing city", billingState: "Billing state",
  billingPostalCode: "Billing ZIP code", primaryEmail: "Primary email",
  email: "Email", phone: "Phone",
  phoneExtension: "Extension", cellPhone: "Cell phone",
}

export type SageContactEditorTarget = {
  readonly kind: SageContactKind
  readonly entityId: string
  readonly name: string
}

export function SageContactEditorDialog({
  target,
  onOpenChange,
  onSubmitted,
}: {
  readonly target: SageContactEditorTarget | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmitted?: () => void
}): React.ReactElement {
  const [state, setState] = React.useState<SageContactEditorState | null>(null)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(false)

  const reload = React.useCallback(async () => {
    if (!target) return
    setLoading(true)
    try {
      const next = await getSageContactEditorState(target.kind, target.entityId)
      setState(next)
      setDraft(Object.fromEntries(Object.entries(next?.fields ?? {}).map(([key, value]) => [key, value ?? ""])))
    } catch {
      setState(null)
      toast.error("You do not have permission to edit this contact in Sage")
    } finally {
      setLoading(false)
    }
  }, [target])

  React.useEffect(() => { void reload() }, [reload])

  const refresh = async () => {
    if (!target) return
    setLoading(true)
    try {
      const result = await requestSageContactRefresh(target.kind, target.entityId)
      if (!result.success) toast.error(result.error)
      else toast.success("Sage refresh queued. Reopen or reload after the bridge processes it.")
      await reload()
    } finally {
      setLoading(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target || !state?.fresh) return
    const proposed = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim() || null]))
    setLoading(true)
    try {
      const result = await proposeSageContactChange(target.kind, target.entityId, proposed)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Contact update submitted for Sage review")
      onSubmitted?.()
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Propose Sage contact update</DialogTitle>
          <DialogDescription>
            {target?.name}. Sage remains authoritative; a different authorized reviewer must approve the change.
          </DialogDescription>
        </DialogHeader>
        {loading && !state ? <p className="text-sm text-muted-foreground">Loading contact…</p> : null}
        {state && !state.linked ? (
          <p className="text-sm text-muted-foreground">This contact has no verified Sage record link yet.</p>
        ) : null}
        {state?.linked && !state.fresh ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A recent Sage read is required before editing. Current refresh: {state.refreshStatus ?? "not requested"}.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>Request Sage refresh</Button>
              <Button type="button" variant="ghost" onClick={() => void reload()} disabled={loading}>Check again</Button>
            </div>
          </div>
        ) : null}
        {state?.fresh ? (
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <p className="text-xs text-muted-foreground">Sage read: {state.capturedAt ? new Date(state.capturedAt).toLocaleString() : "unknown"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {state.editableFields.filter((field) => Object.prototype.hasOwnProperty.call(state.fields, field)).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={`sage-contact-${field}`}>{FIELD_LABELS[field] ?? field}</Label>
                  <Input
                    id={`sage-contact-${field}`}
                    value={draft[field] ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                    disabled={loading}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={loading || Object.keys(draft).length === 0}>Submit for review</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
