"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import {
  getImportedParticipantCandidates,
  resolveImportedParticipantAction,
} from "@/app/actions/imported-participant-review"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { ReviewCandidate, ReviewOutcome, SplitPieceOutcome } from "@/lib/domain/conversations/imported-participant-resolve"
import type { ImportedParticipantReviewRow } from "@/lib/domain/conversations/imported-participant-review"

export type ReviewAction = "pick" | "split" | "leave"

const TITLES: Record<ReviewAction, string> = {
  pick: "Pick person",
  split: "Split into people",
  leave: "Leave as is",
}

type Candidates =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly list: readonly ReviewCandidate[] }
  | { readonly kind: "error"; readonly message: string }

/** Initial split: the literal cut at ";" and ", " (staff adjust it). */
function initialPieces(literal: string): string {
  return literal.split(/;\s*|,\s+/).map((piece) => piece.trim()).filter(Boolean).join("\n")
}

/**
 * One review decision for an unresolved imported participant. "Pick person"
 * shows only the exact-match candidates; "Split into people" lets staff mark
 * the names (one per line, text from the original only) and checks each
 * name before saving. After saving, a staff-only conversation stays
 * staff-only, and the dialog says so.
 */
export function ParticipantReviewDialog({
  row,
  action,
  onOpenChange,
  onReviewed,
}: {
  readonly row: ImportedParticipantReviewRow | null
  readonly action: ReviewAction
  readonly onOpenChange: (open: boolean) => void
  readonly onReviewed: () => void
}): React.ReactElement {
  const [candidates, setCandidates] = React.useState<Candidates>({ kind: "loading" })
  const [picked, setPicked] = React.useState("")
  const [pieces, setPieces] = React.useState("")
  const [preview, setPreview] = React.useState<readonly SplitPieceOutcome[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [done, setDone] = React.useState<ReviewOutcome | null>(null)

  const rowId = row?.id ?? null
  React.useEffect(() => {
    setPicked("")
    setPreview(null)
    setError(null)
    setDone(null)
    setPieces(row ? initialPieces(row.literal) : "")
    if (!rowId || action !== "pick") return
    let current = true
    setCandidates({ kind: "loading" })
    void getImportedParticipantCandidates(rowId).then((result) => {
      if (!current) return
      setCandidates(result.success ? { kind: "ready", list: result.data } : { kind: "error", message: result.error })
    })
    return () => { current = false }
  }, [rowId, action, row])

  const splitPieces = pieces.split("\n").map((piece) => piece.trim()).filter(Boolean)

  async function submit(apply: boolean): Promise<void> {
    if (!row) return
    const decision = action === "pick"
      ? { type: "pick" as const, personKey: picked }
      : action === "split" ? { type: "split" as const, pieces: splitPieces } : { type: "leave" as const }
    setSaving(true)
    setError(null)
    const result = await resolveImportedParticipantAction({ rowId: row.id, decision, apply })
    setSaving(false)
    if (!result.success) {
      setError(result.error)
      setPreview(null)
      return
    }
    if (!apply) {
      setPreview(result.data.pieces)
      return
    }
    toast.success(action === "leave" ? "Marked as reviewed" : "Participant resolved")
    setDone(result.data)
    onReviewed()
  }

  const canSave = !saving && (action === "leave" || (action === "pick" && picked !== "") || (action === "split" && preview !== null))

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{TITLES[action]}</DialogTitle>
          <DialogDescription className="break-words">
            As written: <span className="font-medium text-foreground">{row?.literal}</span>
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-2 text-sm">
            <p>{done.decision === "leave" ? "Marked as reviewed with no person." : `Resolved to ${done.people.join(", ")}.`}</p>
            {done.stillStaffOnly ? (
              <p className="text-muted-foreground">
                This conversation is still staff-only. To let the owner or vendor see it, open the conversation and use Share with owner/vendor… when you are ready.
                {done.channelId ? <> <Link className="underline" href={`/dashboard/conversations/${encodeURIComponent(done.channelId)}`}>Open conversation</Link></> : null}
              </p>
            ) : null}
          </div>
        ) : action === "pick" ? (
          candidates.kind === "loading" ? <p className="text-sm text-muted-foreground">Finding people with this exact name or email…</p>
          : candidates.kind === "error" ? <p role="alert" className="text-sm text-destructive">{candidates.message}</p>
          : candidates.list.length === 0 ? <p className="text-sm text-muted-foreground">No contact has this exact name or email now. Leave it as is instead.</p>
          : (
            <RadioGroup value={picked} onValueChange={setPicked} aria-label="People with this exact name or email">
              {candidates.list.map((candidate) => (
                <div key={candidate.personKey} className="flex items-start gap-2">
                  <RadioGroupItem value={candidate.personKey} id={`candidate-${candidate.personKey}`} className="mt-0.5" />
                  <Label htmlFor={`candidate-${candidate.personKey}`} className="flex flex-col items-start gap-0.5 font-normal">
                    <span className="font-medium">{candidate.name}</span>
                    <span className="text-xs text-muted-foreground">{[candidate.kind, ...candidate.emails].join(" · ")}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )
        ) : action === "split" ? (
          <div className="space-y-2">
            <Label htmlFor="participant-split">One person per line, using only text from the original</Label>
            <Textarea
              id="participant-split"
              value={pieces}
              rows={Math.min(Math.max(splitPieces.length + 1, 3), 10)}
              onChange={(event) => { setPieces(event.target.value); setPreview(null) }}
            />
            <p className="text-xs text-muted-foreground">
              Each name is matched exactly. A name with one exact match is linked; a name with none is added as a new contact without an invitation.
            </p>
            {preview ? (
              <ul className="space-y-1 text-sm">
                {preview.map((item) => (
                  <li key={item.piece}>
                    <span className="font-medium">{item.piece}</span>
                    <span className="text-muted-foreground"> — {item.outcome === "linked" ? `links to ${item.name}` : "new contact, not invited"}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Mark this as reviewed with no person. The text stays exactly as written.</p>
        )}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{done ? "Close" : "Cancel"}</Button>
          {done ? null : action === "split" && preview === null ? (
            <Button type="button" disabled={saving || splitPieces.length === 0} onClick={() => void submit(false)}>Check names</Button>
          ) : (
            <Button type="button" disabled={!canSave} onClick={() => void submit(true)}>
              {action === "leave" ? "Leave as is" : action === "pick" ? "Link to this person" : "Save people"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
