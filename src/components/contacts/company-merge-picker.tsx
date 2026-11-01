"use client"

import * as React from "react"

import { findCompanyMergeCandidates } from "@/app/actions/contact-directory"
import type { CompanyDirectoryKind, CompanyMergeCandidate } from "@/lib/domain/contacts/directory-page"
import { RecordSearchInput } from "@/components/record-table"
import { cn } from "@/lib/utils"

const SEARCH_DEBOUNCE_MS = 250

export type MergeChoice = { readonly id: string; readonly name: string; readonly email: string | null }

type SearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "done"; readonly candidates: readonly CompanyMergeCandidate[] }
  | { readonly kind: "error"; readonly message: string }

/**
 * Finds the other record for "Merge with…": a server-side search by company,
 * person, email or phone. Records that cannot be merged here stay in the
 * results with the reason, instead of disappearing.
 */
export function CompanyMergePicker({
  kind,
  anchor,
  selectedId,
  onSelect,
}: {
  readonly kind: CompanyDirectoryKind
  readonly anchor: MergeChoice
  readonly selectedId: string | null
  readonly onSelect: (choice: MergeChoice) => void
}): React.ReactElement {
  const [search, setSearch] = React.useState("")
  const [state, setState] = React.useState<SearchState>({ kind: "idle" })
  const listId = React.useId()

  React.useEffect(() => {
    const term = search.trim()
    if (!term) {
      setState({ kind: "idle" })
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setState({ kind: "loading" })
      void findCompanyMergeCandidates({ kind, search: term, excludeId: anchor.id }).then((result) => {
        if (!active) return
        setState(result.success ? { kind: "done", candidates: result.data } : { kind: "error", message: result.error })
      }).catch(() => {
        if (active) setState({ kind: "error", message: "Could not search records." })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => { active = false; window.clearTimeout(timer) }
  }, [search, kind, anchor.id])

  const noun = kind === "vendor" ? "vendor" : "client or lead"
  return (
    <div className="space-y-2 text-sm">
      <p><span className="font-medium">Merging:</span> {anchor.name}{anchor.email ? ` · ${anchor.email}` : ""}</p>
      <RecordSearchInput
        value={search}
        onChange={setSearch}
        label={`Find the duplicate ${noun}`}
        placeholder="Search company, person, email or phone…"
      />
      <div id={listId} role="listbox" aria-label={`Matching ${noun} records`} className="max-h-56 overflow-y-auto border-y">
        {state.kind === "idle" ? <p className="px-2 py-3 text-muted-foreground">Type to find the duplicate {noun}.</p> : null}
        {state.kind === "loading" ? <p role="status" className="px-2 py-3 text-muted-foreground">Searching…</p> : null}
        {state.kind === "error" ? <p role="alert" className="px-2 py-3 text-destructive">{state.message}</p> : null}
        {state.kind === "done" && state.candidates.length === 0 ? (
          <p className="px-2 py-3 text-muted-foreground">No other {noun} matches this search.</p>
        ) : null}
        {state.kind === "done" ? state.candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="option"
            aria-selected={candidate.id === selectedId}
            aria-disabled={candidate.blockedReason !== null}
            disabled={candidate.blockedReason !== null}
            onClick={() => onSelect({ id: candidate.id, name: candidate.name, email: candidate.email })}
            className={cn(
              "block w-full px-2 py-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:hover:bg-transparent",
              candidate.id === selectedId && "bg-accent",
            )}
          >
            <span className={cn("block font-medium", candidate.blockedReason && "text-muted-foreground")}>{candidate.name}</span>
            <span className="block text-xs text-muted-foreground">
              {[candidate.detail, candidate.email].filter(Boolean).join(" · ")}
            </span>
            {candidate.blockedReason ? <span className="block text-xs text-destructive">{candidate.blockedReason}</span> : null}
          </button>
        )) : null}
      </div>
    </div>
  )
}
