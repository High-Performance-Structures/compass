"use client"

import * as React from "react"
import { toast } from "sonner"

import { runImportedParticipantAutoResolve } from "@/app/actions/imported-participant-review"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AutoResolveSummary } from "@/lib/domain/conversations/participant-auto-resolve"
import { MATCH_TYPES, MATCH_TYPE_LABELS } from "@/lib/domain/conversations/participant-matching"

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "preview"; readonly summary: AutoResolveSummary }
  | { readonly kind: "done"; readonly summary: AutoResolveSummary }

const count = (value: number): string => value.toLocaleString()

/**
 * Automatic matching for Contacts → Needs review (admins): first a preview of
 * every name or email Compass can match clearly, by how it matched, then one
 * click to resolve them all. Legal-hold projects are never changed, and
 * nothing is shared, notified or emailed.
 */
export function ParticipantAutoMatchDialog({ open, onOpenChange, onDone }: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onDone: () => void
}): React.ReactElement {
  const [state, setState] = React.useState<State>({ kind: "loading" })
  const [running, setRunning] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let current = true
    setState({ kind: "loading" })
    void runImportedParticipantAutoResolve(false).then((result) => {
      if (!current) return
      setState(result.success ? { kind: "preview", summary: result.data } : { kind: "error", message: result.error })
    })
    return () => { current = false }
  }, [open])

  async function apply(): Promise<void> {
    setRunning(true)
    const result = await runImportedParticipantAutoResolve(true)
    setRunning(false)
    if (!result.success) {
      setState({ kind: "error", message: result.error })
      return
    }
    toast.success(`Matched ${count(result.data.resolved.identities)} people`)
    setState({ kind: "done", summary: result.data })
    onDone()
  }

  const summary = state.kind === "preview" || state.kind === "done" ? state.summary : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Match automatically</DialogTitle>
          <DialogDescription>
            Staff are recognized by their sign-in email, their other email addresses (Settings → Team) and your company email domains (Settings → Workflows). Add those first. Everyone else is matched only when the email or name is clearly one person or one vendor.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "loading" ? <p className="text-sm text-muted-foreground">Checking every name and email…</p> : null}
        {state.kind === "error" ? <p role="alert" className="text-sm text-destructive">{state.message}</p> : null}
        {summary ? (
          <div className="space-y-4 text-sm">
            <p>
              {state.kind === "done" ? "Matched" : "Will match"} <span className="font-medium">{count(summary.resolved.identities)}</span> of {count(summary.identities)} names and emails
              ({count(summary.resolved.rows)} of {count(summary.rows)} message entries).
              {" "}{count(summary.leftover.identities)} stay for review{summary.legalHold.rows > 0 ? `, and ${count(summary.legalHold.rows)} entries on legal-hold projects are left unchanged` : ""}.
            </p>
            <ul aria-label="How names were matched" className="divide-y border-y">
              {MATCH_TYPES.filter((type) => summary.byMatchType[type].groups > 0).map((type) => (
                <li key={type} className="flex items-baseline justify-between gap-3 py-1">
                  <span>{MATCH_TYPE_LABELS[type]}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {count(summary.byMatchType[type].identities)} names · {count(summary.byMatchType[type].rows)} entries
                  </span>
                </li>
              ))}
            </ul>
            {summary.examples.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Largest matches — check these before you continue</p>
                <ul className="divide-y border-y">
                  {summary.examples.map((example) => (
                    <li key={`${example.literal}|${example.target}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                      <span className="min-w-0 break-all">{example.literal} → <span className="font-medium">{example.target}</span></span>
                      <span className="text-xs text-muted-foreground tabular-nums">{MATCH_TYPE_LABELS[example.matchType]} · {count(example.rows)} on {example.projects} {example.projects === 1 ? "project" : "projects"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">Conversations stay staff-only. Nobody is invited, notified or emailed.</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{state.kind === "done" ? "Close" : "Cancel"}</Button>
          {state.kind === "preview" ? (
            <Button type="button" disabled={running || state.summary.resolved.rows === 0} onClick={() => void apply()}>
              {running ? "Matching…" : `Match ${count(state.summary.resolved.identities)} names`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
