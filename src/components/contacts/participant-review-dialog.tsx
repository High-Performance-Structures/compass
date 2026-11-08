"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import {
  getImportedParticipantCompanySuggestions,
  getImportedParticipantSuggestions,
  resolveImportedParticipantAction,
  searchImportedParticipantPeople,
} from "@/app/actions/imported-participant-review"
import { CompanySearchPicker } from "@/components/contacts/company-merge-picker"
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
import { Textarea } from "@/components/ui/textarea"
import type { ActionResult } from "@/lib/action-result"
import type { CompanyMergeCandidate } from "@/lib/domain/contacts/directory-page"
import type { CompanySuggestion, GroupReviewOutcome } from "@/lib/domain/conversations/imported-participant-group-resolve"
import type { ReviewPerson, SplitChoice } from "@/lib/domain/conversations/imported-participant-resolve"
import type { ImportedParticipantReviewRow } from "@/lib/domain/conversations/imported-participant-review"
import { cn } from "@/lib/utils"

export type ReviewAction = "pick" | "split" | "leave"

const TITLES: Record<ReviewAction, string> = {
  pick: "Pick person",
  split: "Split into people",
  leave: "Leave as is",
}

type Suggestions =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly list: readonly ReviewPerson[] }
  | { readonly kind: "error"; readonly message: string }

type Chosen = { readonly ref: string; readonly name: string }

type Line = {
  readonly text: string
  readonly suggestions: Suggestions
  /** null: a new uninvited contact. */
  readonly person: Chosen | null
  readonly searching: boolean
}

/** Initial split: the literal cut at ";" and ", " (staff adjust it). */
function initialPieces(literal: string): string {
  return literal.split(/;\s*|,\s+/).map((piece) => piece.trim()).filter(Boolean).join("\n")
}

function detail(person: ReviewPerson): string {
  return [person.label, person.email, person.phone].filter(Boolean).join(" · ")
}

/** Suggested people (exact name or email) as choices; a hint, never the only option. */
function SuggestedPeople({ suggestions, selectedRef, onSelect }: {
  readonly suggestions: Suggestions
  readonly selectedRef: string | null
  readonly onSelect: (person: Chosen) => void
}): React.ReactElement | null {
  if (suggestions.kind === "loading") return <p className="text-xs text-muted-foreground">Looking for people with this exact name or email…</p>
  if (suggestions.kind === "error") return <p role="alert" className="text-xs text-destructive">{suggestions.message}</p>
  if (suggestions.list.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Suggested</p>
      <div role="listbox" aria-label="Suggested people" className="border-y">
        {suggestions.list.map((person) => (
          <button
            key={person.ref}
            type="button"
            role="option"
            aria-selected={person.ref === selectedRef}
            onClick={() => onSelect({ ref: person.ref, name: person.name })}
            className={cn("block w-full px-2 py-2 text-left text-sm hover:bg-accent", person.ref === selectedRef && "bg-accent")}
          >
            <span className="block font-medium">{person.name}</span>
            <span className="block text-xs text-muted-foreground">{detail(person)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Vendors the email's domain points to: add the person as a new, uninvited contact there. */
function CompanySuggestions({ list, selectedId, onSelect }: {
  readonly list: readonly CompanySuggestion[]
  readonly selectedId: string | null
  readonly onSelect: (company: CompanySuggestion) => void
}): React.ReactElement | null {
  if (list.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Company from the email domain</p>
      <div role="listbox" aria-label="Suggested companies" className="border-y">
        {list.map((company) => (
          <button
            key={company.vendorId}
            type="button"
            role="option"
            aria-selected={company.vendorId === selectedId}
            onClick={() => onSelect(company)}
            className={cn("block w-full px-2 py-2 text-left text-sm hover:bg-accent", company.vendorId === selectedId && "bg-accent")}
          >
            <span className="block font-medium">New contact of {company.vendorName}</span>
            <span className="block text-xs text-muted-foreground">
              {company.reason === "domain" ? "Their people use the same email domain" : "The company name reads like the email domain"} · not invited
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Anyone in the company directory, through the server-side people search. */
function PeopleSearch({ rowId, selectedRef, onSelect }: {
  readonly rowId: string
  readonly selectedRef: string | null
  readonly onSelect: (person: Chosen) => void
}): React.ReactElement {
  const find = React.useCallback(async (search: string): Promise<ActionResult<readonly CompanyMergeCandidate[]>> => {
    const result = await searchImportedParticipantPeople(rowId, search)
    if (!result.success) return result
    return {
      success: true,
      data: result.data.map((person) => ({ id: person.ref, name: person.name, email: person.email, detail: [person.label, person.phone].filter(Boolean).join(" · "), blockedReason: null })),
    }
  }, [rowId])
  return (
    <CompanySearchPicker
      find={find}
      label="Find anyone in the directory"
      idleText="Type a name, email or phone to find staff, vendors, clients or unassigned people."
      emptyText="Nobody in the directory matches this search."
      selectedId={selectedRef}
      onSelect={(choice) => onSelect({ ref: choice.id, name: choice.name })}
    />
  )
}

/**
 * One review decision for an unresolved imported participant. Staff may
 * choose anyone in the directory; people whose exact name or email matches
 * are suggested first. "Split into people" lets staff mark the names (one
 * per line; staff may type full names the imported text cut short) and choose, for each, a suggested
 * person, anyone else, or a new uninvited contact. After saving, a
 * staff-only conversation stays staff-only, and the dialog says so.
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
  const [suggestions, setSuggestions] = React.useState<Suggestions>({ kind: "loading" })
  const [picked, setPicked] = React.useState<Chosen | null>(null)
  const [companies, setCompanies] = React.useState<readonly CompanySuggestion[]>([])
  const [company, setCompany] = React.useState<CompanySuggestion | null>(null)
  const [pieces, setPieces] = React.useState("")
  const [lines, setLines] = React.useState<readonly Line[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [done, setDone] = React.useState<GroupReviewOutcome | null>(null)

  const rowId = row?.id ?? null
  const literal = row?.literal ?? ""
  React.useEffect(() => {
    setPicked(null)
    setCompany(null)
    setCompanies([])
    setLines(null)
    setError(null)
    setDone(null)
    setPieces(initialPieces(literal))
    if (!rowId || action !== "pick") return
    let current = true
    setSuggestions({ kind: "loading" })
    void getImportedParticipantSuggestions(rowId, null).then((result) => {
      if (!current) return
      setSuggestions(result.success ? { kind: "ready", list: result.data } : { kind: "error", message: result.error })
    })
    void getImportedParticipantCompanySuggestions(rowId).then((result) => {
      if (current && result.success) setCompanies(result.data)
    })
    return () => { current = false }
  }, [rowId, action, literal])

  function choosePerson(person: Chosen): void {
    setPicked(person)
    setCompany(null)
  }

  const splitPieces = pieces.split("\n").map((piece) => piece.trim()).filter(Boolean)

  const updateLine = React.useCallback((index: number, change: Partial<Line>) => {
    setLines((current) => current ? current.map((line, at) => (at === index ? { ...line, ...change } : line)) : current)
  }, [])

  /** Step two of a split: each marked name with its suggestions; one exact match is chosen by default. */
  async function chooseForLines(): Promise<void> {
    if (!rowId) return
    const texts = splitPieces
    setError(null)
    setLines(texts.map((text) => ({ text, suggestions: { kind: "loading" }, person: null, searching: false })))
    const results = await Promise.all(texts.map((text) => getImportedParticipantSuggestions(rowId, text)))
    setLines(texts.map((text, index) => {
      const result = results[index]
      const list = result?.success ? result.data : []
      const only = list.length === 1 ? list[0] : undefined
      return {
        text,
        suggestions: result?.success ? { kind: "ready", list } : { kind: "error", message: result?.error ?? "Could not load suggestions." },
        person: only ? { ref: only.ref, name: only.name } : null,
        searching: false,
      }
    }))
  }

  async function save(): Promise<void> {
    if (!row) return
    const decision = action === "pick"
      ? company ? { type: "vendor" as const, vendorId: company.vendorId } : { type: "pick" as const, ref: picked?.ref ?? "" }
      : action === "split"
        ? { type: "split" as const, pieces: (lines ?? []).map((line) => ({ text: line.text, choice: line.person ? { type: "person" as const, ref: line.person.ref } satisfies SplitChoice : { type: "new" as const } })) }
        : { type: "leave" as const }
    setSaving(true)
    setError(null)
    const result = await resolveImportedParticipantAction({ rowId: row.id, decision, apply: true })
    setSaving(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    toast.success(action === "leave" ? "Marked as reviewed" : "Participant resolved")
    setDone(result.data)
    onReviewed()
  }

  const canSave = !saving && (action === "leave" || (action === "pick" && (picked !== null || company !== null)) || (action === "split" && lines !== null && lines.length > 0))

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{TITLES[action]}</DialogTitle>
          <DialogDescription className="break-words">
            As written: <span className="font-medium text-foreground">{row?.literal}</span>
            {row ? <span className="block">{row.messageCount} {row.messageCount === 1 ? "message" : "messages"} on {row.projectCount} {row.projectCount === 1 ? "project" : "projects"}. Your choice applies to all of them{row.someLegalHold ? ", except legal-hold projects, which stay unchanged" : ""}.</span> : null}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-2 text-sm">
            <p>
              {done.decision === "leave" ? "Marked as reviewed with no person" : `Resolved to ${done.people.join(", ")}`}
              {` on ${done.projects} ${done.projects === 1 ? "project" : "projects"} (${done.rowsReviewed} message ${done.rowsReviewed === 1 ? "entry" : "entries"}).`}
            </p>
            {done.legalHoldRows > 0 ? (
              <p className="text-muted-foreground">{done.legalHoldRows} on legal-hold projects were left unchanged.</p>
            ) : null}
            {done.stillStaffOnly ? (
              <p className="text-muted-foreground">
                The conversations are still staff-only. To let an owner or vendor see one, open it and use Share with owner/vendor… when you are ready.
                {row?.channelId ? <> <Link className="underline" href={`/dashboard/conversations/${encodeURIComponent(row.channelId)}`}>Open conversation</Link></> : null}
              </p>
            ) : null}
          </div>
        ) : action === "pick" && rowId ? (
          <div className="space-y-3">
            <SuggestedPeople suggestions={suggestions} selectedRef={picked?.ref ?? null} onSelect={choosePerson} />
            <CompanySuggestions list={companies} selectedId={company?.vendorId ?? null} onSelect={(choice) => { setCompany(choice); setPicked(null) }} />
            <PeopleSearch rowId={rowId} selectedRef={picked?.ref ?? null} onSelect={choosePerson} />
            {picked ? <p className="text-sm">Selected: <span className="font-medium">{picked.name}</span></p> : null}
            {company ? <p className="text-sm">Selected: <span className="font-medium">new contact of {company.vendorName}</span></p> : null}
          </div>
        ) : action === "split" && rowId ? (
          lines === null ? (
            <div className="space-y-2">
              <Label htmlFor="participant-split">One person per line. Type the full name if the imported text is cut short.</Label>
              <Textarea
                id="participant-split"
                value={pieces}
                rows={Math.min(Math.max(splitPieces.length + 1, 3), 10)}
                onChange={(event) => setPieces(event.target.value)}
              />
            </div>
          ) : (
            <ol className="space-y-4">
              {lines.map((line, index) => (
                <li key={line.text} className="space-y-2 border-b pb-3 last:border-b-0">
                  <p className="text-sm"><span className="font-medium">{line.text}</span>
                    <span className="text-muted-foreground"> — {line.person ? `links to ${line.person.name}` : "new contact, not invited"}</span>
                  </p>
                  <SuggestedPeople suggestions={line.suggestions} selectedRef={line.person?.ref ?? null} onSelect={(person) => updateLine(index, { person })} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => updateLine(index, { searching: !line.searching })}>
                      {line.searching ? "Hide search" : "Pick someone else…"}
                    </Button>
                    <Button type="button" size="sm" variant={line.person ? "outline" : "secondary"} onClick={() => updateLine(index, { person: null, searching: false })}>
                      New contact (not invited)
                    </Button>
                  </div>
                  {line.searching ? <PeopleSearch rowId={rowId} selectedRef={line.person?.ref ?? null} onSelect={(person) => updateLine(index, { person })} /> : null}
                </li>
              ))}
            </ol>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Mark every row of this name as reviewed with no person. The text stays exactly as written.</p>
        )}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{done ? "Close" : "Cancel"}</Button>
          {done ? null : action === "split" && lines === null ? (
            <Button type="button" disabled={splitPieces.length === 0} onClick={() => void chooseForLines()}>Next: choose people</Button>
          ) : (
            <>
              {action === "split" ? <Button type="button" variant="ghost" onClick={() => setLines(null)}>Back</Button> : null}
              <Button type="button" disabled={!canSave} onClick={() => void save()}>
                {action === "leave" ? "Leave as is" : action === "pick" ? "Link to this person" : "Save people"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
