"use client"

/*
 * The owner's choosing view: rooms down the side, each published selection
 * as a card of choice photos with the owner price and over/under the
 * allowance (owner prices include the builder fee), a link to the supplier's
 * page, "Suggest an item (paste a link)" and "Ask a question". Tapping a
 * card makes it the owner's pick; they can change it until the selection is
 * approved. Staff previewing the owner view see it read-only.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCheck, IconExternalLink } from "@tabler/icons-react"

import { setSelectionChoiceChosen } from "@/app/actions/selection-choices"
import { SelectionComments } from "@/components/selections/selection-comments"
import { PasteLinkDialog } from "@/components/selections/selection-detail-dialogs"
import { linkSiteName, SelectionLinkCard } from "@/components/selections/selection-link-card"
import { Button } from "@/components/ui/button"
import { allowanceDeltaCents } from "@/lib/domain/selections/choice-rules"
import type { SelectionChoiceView } from "@/lib/domain/selections/choices-read"
import type { OwnerBoardSelection } from "@/lib/domain/selections/owner-board-read"
import { formatCents, formatDate } from "@/lib/format"
import { projectAudiencePhotoUrl } from "@/lib/photo-sources"
import { ownerBoardTotals } from "@/lib/selections/owner-board"
import { cn } from "@/lib/utils"

/** "$550 under" / "$985 over" / "on allowance", in words for owners. */
function OwnerDelta({ deltaCents }: { readonly deltaCents: number }): React.ReactElement {
  if (deltaCents === 0) return <span>on allowance</span>
  return (
    <span className={cn("font-semibold", deltaCents > 0 ? "text-destructive" : "text-primary")}>
      {formatCents(Math.abs(deltaCents))} {deltaCents > 0 ? "over" : "under"}
    </span>
  )
}

function ChoiceImage({ projectId, choice }: { readonly projectId: string; readonly choice: SelectionChoiceView }): React.ReactElement {
  const photo = choice.photos[0]
  const linkImage = choice.links.find((link) => link.imageUrl)?.imageUrl
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- owner-visible project photo served by the photos route
    return <img src={projectAudiencePhotoUrl(projectId, photo.photoId, "owner")} alt={photo.fileName} loading="lazy" className="h-36 w-full object-cover" />
  }
  if (linkImage) {
    // eslint-disable-next-line @next/next/no-img-element -- the supplier page's own image
    return <img src={linkImage} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-36 w-full object-cover" />
  }
  return <span aria-hidden className="block h-36 w-full bg-muted" />
}

function SelectionCard({
  projectId,
  selection,
  canChoose,
  onChanged,
}: {
  readonly projectId: string
  readonly selection: OwnerBoardSelection
  readonly canChoose: boolean
  readonly onChanged: () => void
}): React.ReactElement {
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const [suggesting, setSuggesting] = React.useState(false)
  const [asking, setAsking] = React.useState(selection.panel.comments.length > 0)
  const choices = selection.panel.choices
  const pick = choices.find((choice) => choice.chosen) ?? null
  const locked = !canChoose || selection.approved

  function choose(choice: SelectionChoiceView): void {
    if (locked) return
    setError(null)
    startTransition(async () => {
      const result = await setSelectionChoiceChosen(projectId, choice.id, !choice.chosen, "owner")
      if (!result.success) setError(result.error)
      onChanged()
    })
  }

  const followUps = pick ? (selection.followUpNames[pick.id] ?? []) : []
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby={`owner-selection-${selection.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`owner-selection-${selection.id}`} className="text-lg font-semibold">
          {selection.name}
        </h3>
        <span className="text-sm">
          {selection.allowanceCents !== null && (
            <>
              Allowance <b>{formatCents(selection.allowanceCents)}</b>
            </>
          )}
          {selection.dueDate && <span className="text-muted-foreground"> · choose by {formatDate(selection.dueDate)}</span>}
          {selection.approved && <span className="text-muted-foreground"> · approved</span>}
        </span>
      </div>
      {choices.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your builder is still gathering choices for this one.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {choices.map((choice) => {
            const link = choice.links[0] ?? null
            const delta = allowanceDeltaCents(choice.ownerPriceCents, selection.allowanceCents)
            return (
              <div
                key={choice.id}
                className={cn("flex flex-col overflow-hidden rounded-lg border", choice.chosen && "border-2 border-primary bg-primary/5")}
              >
                <button
                  type="button"
                  aria-pressed={choice.chosen}
                  disabled={locked || pending}
                  onClick={() => choose(choice)}
                  className="flex flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:cursor-pointer disabled:cursor-default"
                >
                  <ChoiceImage projectId={projectId} choice={choice} />
                  <span className="flex flex-col gap-1 p-3">
                    <span className="font-semibold">
                      {choice.chosen && <IconCheck className="mr-1 inline size-4 align-[-2px]" aria-hidden />}
                      {choice.title}
                    </span>
                    <span className="text-sm">
                      {choice.ownerPriceCents !== null ? formatCents(choice.ownerPriceCents) : <span className="text-muted-foreground">Price coming</span>}
                      {delta !== null && (
                        <>
                          {" · "}
                          <OwnerDelta deltaCents={delta} />
                        </>
                      )}
                    </span>
                    {choice.description && <span className="line-clamp-2 text-xs text-muted-foreground">{choice.description}</span>}
                  </span>
                </button>
                {link && (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-3 mb-3 text-sm text-primary underline-offset-2 hover:underline"
                  >
                    View on {linkSiteName(link)} <IconExternalLink className="inline size-3.5 align-[-2px]" aria-hidden />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
      {selection.panel.selectionLinks.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Suggested items</span>
          {selection.panel.selectionLinks.map((link) => (
            <SelectionLinkCard key={link.id} link={link} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canChoose && (
          <Button type="button" variant="outline" onClick={() => setSuggesting(true)}>
            Suggest an item (paste a link)
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => setAsking((value) => !value)} aria-expanded={asking}>
          Ask a question
        </Button>
        {pick && followUps.length > 0 && (
          <span className="text-sm text-muted-foreground">
            Choosing {pick.title} also asks you for {followUps.join(" and ")}.
          </span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {asking && (
        canChoose ? (
          <SelectionComments
            projectId={projectId}
            selectionId={selection.id}
            audience="owner"
            comments={selection.panel.comments}
            onChanged={onChanged}
            placeholder="Ask your builder a question…"
          />
        ) : (
          <p className="text-sm text-muted-foreground">Preview: owners ask questions here.</p>
        )
      )}
      <PasteLinkDialog
        projectId={projectId}
        selectionId={selection.id}
        choiceId={null}
        targetLabel={selection.name}
        audience="owner"
        open={suggesting}
        onOpenChange={setSuggesting}
        onSaved={onChanged}
      />
    </section>
  )
}

export function OwnerChoiceBoard({
  projectId,
  selections,
  canChoose,
}: {
  readonly projectId: string
  readonly selections: readonly OwnerBoardSelection[]
  /** False when staff preview the owner's view. */
  readonly canChoose: boolean
}): React.ReactElement | null {
  const router = useRouter()
  const rooms = React.useMemo(() => [...new Set(selections.map((selection) => selection.roomName))], [selections])
  const [room, setRoom] = React.useState(rooms[0] ?? "")
  const refresh = React.useCallback(() => router.refresh(), [router])
  if (selections.length === 0) return null
  const totals = ownerBoardTotals(selections)
  const inRoom = selections.filter((selection) => selection.roomName === room)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">Choose your selections</h2>
        <p className="text-sm text-muted-foreground">Tap a choice to pick it. You can change your mind until your builder asks you to sign.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <span className="text-sm">
            <b>
              {totals.chosen} of {totals.total} chosen
            </b>
            {totals.total > totals.chosen && <> · {totals.total - totals.chosen} left</>}
          </span>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full bg-primary" style={{ width: `${totals.total ? Math.round((totals.chosen / totals.total) * 100) : 0}%` }} />
          </div>
        </div>
        {totals.allowanceCents !== null && totals.pickedCents !== null && (
          <p className="min-w-60 flex-1 text-sm">
            Allowance for what you&apos;ve chosen <b>{formatCents(totals.allowanceCents)}</b> · your choices <b>{formatCents(totals.pickedCents)}</b>
            {" · "}
            <OwnerDelta deltaCents={totals.deltaCents} />{" "}
            <span className="text-muted-foreground">(includes builder fee)</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <nav aria-label="Rooms" className="flex flex-[1_1_200px] flex-col gap-2">
          {rooms.map((name) => {
            const roomSelections = selections.filter((selection) => selection.roomName === name)
            const chosen = roomSelections.filter((selection) => selection.panel.choices.some((choice) => choice.chosen)).length
            return (
              <button
                key={name}
                type="button"
                aria-current={name === room ? "true" : undefined}
                onClick={() => setRoom(name)}
                className={cn(
                  "flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  name === room && "border-primary bg-primary/10",
                )}
              >
                <span className="min-w-0 truncate">{name}</span>
                <span className="flex-none text-muted-foreground">
                  {chosen} of {roomSelections.length}
                </span>
              </button>
            )
          })}
        </nav>
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          {inRoom.map((selection) => (
            <SelectionCard key={selection.id} projectId={projectId} selection={selection} canChoose={canChoose} onChanged={refresh} />
          ))}
        </div>
      </div>
    </div>
  )
}
