"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { publishSelectionDecision } from "@/app/actions/selection-decisions"
import { selectionPublicationInput } from "@/lib/selections/publication"
import type { SelectionDecisionItem } from "@/lib/selections/types"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type BatchFailure = {
  readonly id: string
  readonly name: string
  readonly error: string
}
export type SelectionBatchState = {
  readonly selected: ReadonlySet<string>
  readonly pending: boolean
  readonly total: number
  readonly progress: number
  readonly failures: readonly BatchFailure[]
  readonly result: string | null
  readonly toggle: (id: string, checked: boolean) => void
  readonly toggleShown: (
    items: readonly SelectionDecisionItem[],
    checked: boolean,
  ) => void
  readonly clear: () => void
  readonly publish: (items: readonly SelectionDecisionItem[]) => Promise<void>
}

export function useSelectionBatch(projectId: string): SelectionBatchState {
  const router = useRouter()
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = React.useState(false)
  const running = React.useRef(false)
  const [total, setTotal] = React.useState(0)
  const [progress, setProgress] = React.useState(0)
  const [failures, setFailures] = React.useState<readonly BatchFailure[]>([])
  const [result, setResult] = React.useState<string | null>(null)
  function toggle(id: string, checked: boolean): void {
    if (running.current) return
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  function toggleShown(
    items: readonly SelectionDecisionItem[],
    checked: boolean,
  ): void {
    if (running.current) return
    setSelected((previous) => {
      const next = new Set(previous)
      for (const item of items.filter((item) => !item.published)) {
        if (checked) next.add(item.id)
        else next.delete(item.id)
      }
      return next
    })
  }
  function clear(): void {
    if (!running.current) {
      setSelected(new Set())
      setFailures([])
      setResult(null)
    }
  }
  async function publish(
    items: readonly SelectionDecisionItem[],
  ): Promise<void> {
    if (running.current || items.length === 0) return
    running.current = true
    setPending(true)
    setTotal(items.length)
    setProgress(0)
    setFailures([])
    setResult(null)
    const errors: BatchFailure[] = []
    const succeeded = new Set<string>()
    try {
      // Each existing server action retains its permission, revision, and audit
      // checks. Small groups avoid one long request or an unbounded request burst.
      for (let offset = 0; offset < items.length; offset += 3) {
        const group = items.slice(offset, offset + 3)
        const results = await Promise.allSettled(
          group.map((item) =>
            publishSelectionDecision(
              projectId,
              selectionPublicationInput(item),
            ),
          ),
        )
        for (const [index, outcome] of results.entries()) {
          const item = group[index]
          if (!item) continue
          if (outcome.status === "fulfilled" && outcome.value.success)
            succeeded.add(item.id)
          else
            errors.push({
              id: item.id,
              name: `${item.currentSpec.roomName}: ${item.currentSpec.name}`,
              error:
                outcome.status === "rejected"
                  ? "Could not confirm publication. Refresh before retrying."
                  : outcome.value.success
                    ? ""
                    : outcome.value.error,
            })
        }
        setProgress(Math.min(offset + group.length, items.length))
      }
      setSelected(
        (previous) => new Set([...previous].filter((id) => !succeeded.has(id))),
      )
      setFailures(errors)
      setResult(
        `${succeeded.size} of ${items.length} selections published to owner.${errors.length ? ` ${errors.length} need attention.` : ""}`,
      )
      router.refresh()
    } finally {
      running.current = false
      setPending(false)
    }
  }
  return {
    selected,
    pending,
    total,
    progress,
    failures,
    result,
    toggle,
    toggleShown,
    clear,
    publish,
  }
}

export function SelectionBatchPublish({
  state,
  items,
  shown,
}: {
  readonly state: SelectionBatchState
  readonly items: readonly SelectionDecisionItem[]
  readonly shown: readonly SelectionDecisionItem[]
}): React.ReactElement {
  const selected = items.filter(
    (item) => !item.published && state.selected.has(item.id),
  )
  const unpublishedShown = shown.filter((item) => !item.published)
  const allShown =
    unpublishedShown.length > 0 &&
    unpublishedShown.every((item) => state.selected.has(item.id))
  return (
    <div className="sticky top-0 z-10 mb-3 border-y bg-background py-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allShown}
            disabled={state.pending || unpublishedShown.length === 0}
            onChange={(event) => state.toggleShown(shown, event.target.checked)}
          />
          Select all shown ({unpublishedShown.length} unpublished)
        </label>
        <span className="text-muted-foreground">
          {selected.length} selected
          {selected.some((item) => !shown.includes(item))
            ? " across filters"
            : ""}
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={state.pending || selected.length === 0}>
              Publish selected to owner
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Publish {selected.length} selections to owner?
              </AlertDialogTitle>
              <AlertDialogDescription>
                These pending or already-selected items will become visible to
                the owner with their current specifications and owner-facing
                terms. Blank pricing stays pending. Publishing does not record
                owner approval.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="max-h-56 overflow-y-auto space-y-1 text-sm">
              {selected.map((item) => (
                <li key={item.id}>
                  {item.currentSpec.roomName}: {item.currentSpec.name}
                </li>
              ))}
            </ul>
            {selected.some((item) => item.approvedAt !== null) && (
              <p className="text-sm text-destructive">
                These selections include a prior approval. Publishing a new
                revision keeps its history and requires fresh owner approval.
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void state.publish(selected)}>
                Publish {selected.length} selections
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          size="sm"
          variant="ghost"
          disabled={state.pending || selected.length === 0}
          onClick={state.clear}
        >
          Clear selection
        </Button>
      </div>
      {state.pending && (
        <p role="status" className="mt-2 text-sm">
          Publishing {state.progress} of {state.total} selections… Keep this
          page open until publishing finishes.
        </p>
      )}
      {state.result && (
        <p role="status" className="mt-2 text-sm">
          {state.result}
        </p>
      )}
      {state.failures.length > 0 && (
        <ul role="alert" className="mt-2 space-y-1 text-sm text-destructive">
          {state.failures.map((failure) => (
            <li key={failure.id}>
              {failure.name}: {failure.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
