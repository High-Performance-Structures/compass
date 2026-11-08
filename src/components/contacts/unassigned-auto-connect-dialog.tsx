"use client"

import * as React from "react"
import { toast } from "sonner"

import { recordUnassignedAutoConnectRun, runUnassignedAutoConnectAction } from "@/app/actions/unassigned-people"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MATCH_TYPE_LABELS, MATCH_TYPES } from "@/lib/domain/conversations/participant-matching"
import type { UnassignedAutoConnectResult } from "@/lib/domain/contacts/unassigned-auto-connect"

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "preview"; readonly result: UnassignedAutoConnectResult }
  | { readonly kind: "running"; readonly done: number; readonly total: number }
  | { readonly kind: "done"; readonly people: number; readonly contacts: number; readonly failed: readonly { readonly name: string; readonly error: string }[] }

const count = (value: number): string => value.toLocaleString()
const MAX_CALLS = 200

/**
 * "Connect automatically…" for Contacts → Unassigned (admins): a preview of
 * the people Compass can tie clearly to one vendor or client, then the
 * connection in small batches through "Connect to company…". Legal-hold
 * projects are skipped unless the admin ticks the box to include them (their
 * conversations stay staff-only), and nobody is invited, notified or emailed.
 */
export function UnassignedAutoConnectDialog({ open, onOpenChange, onDone }: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onDone: () => void
}): React.ReactElement {
  const [state, setState] = React.useState<State>({ kind: "loading" })
  const [includeStaffOnly, setIncludeStaffOnly] = React.useState(false)

  React.useEffect(() => {
    if (!open) setIncludeStaffOnly(false)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    let current = true
    setState({ kind: "loading" })
    void runUnassignedAutoConnectAction({ apply: false, skipped: [], includeStaffOnlyProjects: includeStaffOnly }).then((result) => {
      if (current) setState(result.success ? { kind: "preview", result: result.data } : { kind: "error", message: result.error })
    })
    return () => { current = false }
  }, [open, includeStaffOnly])

  async function run(total: number): Promise<void> {
    let skipped: readonly string[] = []
    let people = 0
    let contacts = 0
    const failed: { name: string; error: string }[] = []
    setState({ kind: "running", done: 0, total })
    for (let call = 0; call < MAX_CALLS; call += 1) {
      const result = await runUnassignedAutoConnectAction({ apply: true, skipped: [...skipped], includeStaffOnlyProjects: includeStaffOnly })
      if (!result.success) {
        setState({ kind: "error", message: result.error })
        break
      }
      people += result.data.connectedPeople
      contacts += result.data.connectedContacts
      failed.push(...result.data.failed)
      skipped = result.data.skippedKeys
      setState({ kind: "running", done: people, total })
      if (result.data.remaining === 0) {
        setState({ kind: "done", people, contacts, failed })
        break
      }
    }
    // One Activity record for the whole run.
    await recordUnassignedAutoConnectRun({ people, contacts, failed: failed.length, includedStaffOnlyProjects: includeStaffOnly })
    if (people > 0) toast.success(`Connected ${count(people)} people`)
    onDone()
  }

  const summary = state.kind === "preview" ? state.result.summary : null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (state.kind !== "running") onOpenChange(next) }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect automatically</DialogTitle>
          <DialogDescription>
            People are connected only when their email is clearly one vendor or client: the same email as someone there, or a business domain only that company uses. Staff (sign-in and other email addresses, company email domains) are never connected to a company. Free email addresses never match by domain.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "loading" || state.kind === "preview" || state.kind === "error" ? (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={includeStaffOnly} onCheckedChange={(value) => setIncludeStaffOnly(value === true)} />
            <span>Include projects whose imported conversations are kept staff-only (for example a legal hold). Conversations stay staff-only.</span>
          </label>
        ) : null}
        {state.kind === "loading" ? <p className="text-sm text-muted-foreground">Checking every unassigned person…</p> : null}
        {state.kind === "error" ? <p role="alert" className="text-sm text-destructive">{state.message}</p> : null}
        {state.kind === "running" ? <p className="text-sm">Connecting… {count(state.done)} of about {count(state.total)} people.</p> : null}
        {state.kind === "done" ? (
          <div className="space-y-2 text-sm">
            <p>Connected {count(state.people)} people ({count(state.contacts)} project contacts).</p>
            {state.failed.length > 0 ? (
              <div className="space-y-1">
                <p className="text-muted-foreground">{count(state.failed.length)} could not be connected and stay in Unassigned:</p>
                <ul className="divide-y border-y">
                  {state.failed.slice(0, 30).map((item, index) => <li key={`${item.name}-${index}`} className="py-1"><span className="font-medium">{item.name}</span>: {item.error}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {summary && state.kind === "preview" ? (
          <div className="space-y-4 text-sm">
            <p>
              <span className="font-medium">{count(summary.total.people)}</span> people ({count(summary.total.identities)} imported names or addresses; {count(summary.duplicateGroups)} people appeared more than once and are shown as one).
              Will connect <span className="font-medium">{count(summary.connect.people)}</span>. {count(summary.staff.people)} are staff, {count(summary.leftover.people)} stay for you to connect{summary.withSuggestion > 0 ? ` (${count(summary.withSuggestion)} with a suggested company)` : ""}, and {includeStaffOnly ? "projects whose conversations are kept staff-only are included" : `${count(summary.legalHoldOnly.people)} are only on legal-hold projects`}.
            </p>
            <ul aria-label="How people were matched" className="divide-y border-y">
              {MATCH_TYPES.flatMap((type) => {
                const totals = summary.byMatchType[type]
                return totals ? [(
                  <li key={type} className="flex items-baseline justify-between gap-3 py-1">
                    <span>{MATCH_TYPE_LABELS[type]}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{count(totals.people)} people</span>
                  </li>
                )] : []
              })}
            </ul>
            {state.result.examples.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Check these before you continue</p>
                <ul className="divide-y border-y">
                  {state.result.examples.map((example) => (
                    <li key={`${example.name}|${example.company}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                      <span className="min-w-0 break-all">{example.name} → <span className="font-medium">{example.company}</span></span>
                      <span className="text-xs text-muted-foreground">{example.identities > 1 ? `${example.identities} duplicates` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={state.kind === "running"} onClick={() => onOpenChange(false)}>{state.kind === "done" ? "Close" : "Cancel"}</Button>
          {state.kind === "preview" ? (
            <Button type="button" disabled={state.result.summary.connect.people === 0} onClick={() => void run(state.result.summary.connect.people)}>
              Connect {count(state.result.summary.connect.people)} people
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
