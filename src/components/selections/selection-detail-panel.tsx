"use client"

/*
 * The staff detail panel in the Selections sheet's record drawer: status,
 * allowance and Selection Phase, then the selection's
 * choices (drag to reorder, owner's pick, links, photos, follow-ups),
 * "Add choice", "Paste product link", "Ask supplier to price", the to-dos
 * and RFQs linked to the selection, and its comments.
 */
import * as React from "react"
import Link from "next/link"
import { IconPlus } from "@tabler/icons-react"

import { createProjectTask } from "@/app/actions/project-todos"
import {
  deleteSelectionChoice,
  deleteSelectionLink,
  getSelectionDetail,
  reorderSelectionChoices,
  setSelectionChoiceChosen,
  type SelectionDetail,
} from "@/app/actions/selection-choices"
import { ProjectSelectionStatusSelect } from "@/components/projects/project-selection-status-select"
import { RecordStatusBadge } from "@/components/record-status-badge"
import { SelectionChoiceCard } from "@/components/selections/selection-choice-card"
import { SelectionChoiceForm } from "@/components/selections/selection-choice-form"
import { SelectionComments } from "@/components/selections/selection-comments"
import { AttachPhotosDialog, FollowUpsDialog, PasteLinkDialog, PickForOwnerDialog } from "@/components/selections/selection-detail-dialogs"
import { SelectionLinkCard } from "@/components/selections/selection-link-card"
import { SelectionPriceRequest } from "@/components/selections/selection-price-request"
import { SelectionReplaceDialog, type SelectionReplaceKind } from "@/components/selections/selection-replace-dialog"
import { createReplacementChangeOrder } from "@/app/actions/selection-replacements"
import { SelectionRoundTemplateControls } from "@/components/selections/selection-round-template-controls"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SortableRows } from "@/components/ui/sortable-rows"
import type { SelectionChoiceView } from "@/lib/domain/selections/choices-read"
import type { SelectionLeadTimeWarning } from "@/lib/domain/selections/lead-time-rules"
import type { RoundCard } from "@/lib/domain/selections/rounds-server"
import type { SupplierOption } from "@/lib/domain/selections/selection-sheet-read"
import { formatCents, formatDate } from "@/lib/format"
import { moveLine } from "@/lib/shared/line-order"
import type { SelectionSheetRow } from "@/lib/selections/sheet"
import { REPLACEMENT_REASON_LABELS } from "@/lib/domain/selections/locks"
import type { SelectionStatusLabels } from "@/lib/domain/selections/status-labels"

type Dialogs =
  | { readonly kind: "none" }
  | { readonly kind: "choice"; readonly choice: SelectionChoiceView | null }
  | { readonly kind: "link"; readonly choice: SelectionChoiceView | null }
  | { readonly kind: "photos"; readonly choice: SelectionChoiceView | null }
  | { readonly kind: "followUps"; readonly choice: SelectionChoiceView }
  | { readonly kind: "pick"; readonly choice: SelectionChoiceView }
  | { readonly kind: "price" }
  | { readonly kind: "replace"; readonly replaceKind: SelectionReplaceKind }

/** A to-do for this selection, made in place: title and an optional due date. */
function SelectionTodoForm({
  defaultTitle,
  pending,
  onCancel,
  onSubmit,
}: {
  readonly defaultTitle: string
  readonly pending: boolean
  readonly onCancel: () => void
  readonly onSubmit: (title: string, dueDate: string | null) => void
}): React.ReactElement {
  const [title, setTitle] = React.useState(defaultTitle)
  const [due, setDue] = React.useState("")
  const id = React.useId()
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim()) onSubmit(title.trim(), due || null)
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-title`}>To-do</Label>
          <Input id={`${id}-title`} value={title} maxLength={200} autoFocus onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-due`}>Due</Label>
          <Input id={`${id}-due`} type="date" value={due} onChange={(event) => setDue(event.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          Add to-do
        </Button>
      </div>
    </form>
  )
}

function Section({ title, aside, children }: { readonly title: string; readonly aside?: React.ReactNode; readonly children: React.ReactNode }): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function SelectionDetailPanel({
  projectId,
  row,
  rows,
  rounds,
  suppliers,
  statusLabels,
  leadTimeWarning,
  onChanged,
}: {
  readonly projectId: string
  readonly row: SelectionSheetRow
  /** Every selection on the job, for the follow-up picker and names. */
  readonly rows: readonly SelectionSheetRow[]
  /** The company's rounds on this job. */
  readonly rounds: readonly RoundCard[]
  readonly suppliers: readonly SupplierOption[]
  /** The company's status names. */
  readonly statusLabels: SelectionStatusLabels
  /** The selection's lead-time warning, shown on the choice that sets it. */
  readonly leadTimeWarning: SelectionLeadTimeWarning | null
  /** Refreshes the sheet after a change. */
  readonly onChanged: () => void
}): React.ReactElement {
  const [detail, setDetail] = React.useState<SelectionDetail | null>(null)
  const [order, setOrder] = React.useState<readonly SelectionChoiceView[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<Dialogs>({ kind: "none" })
  const [pending, startTransition] = React.useTransition()
  const [version, setVersion] = React.useState(0)
  const [todoFormOpen, setTodoFormOpen] = React.useState(false)

  React.useEffect(() => {
    let live = true
    setError(null)
    void getSelectionDetail(projectId, row.id).then((result) => {
      if (!live) return
      if (result.success) {
        setDetail(result.data)
        setOrder(result.data.panel.choices)
      } else {
        setError(result.error)
      }
    })
    return () => {
      live = false
    }
  }, [projectId, row.id, version])

  const reload = React.useCallback((): void => {
    setVersion((value) => value + 1)
    onChanged()
  }, [onChanged])

  function run(action: () => Promise<{ readonly success: boolean; readonly error?: string }>): void {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.success) setError(result.error ?? "That didn't save.")
      reload()
    })
  }

  // Moves optimistically; the server checks the order is still whole and the reload restores it on failure.
  function move(from: number, to: number): void {
    const next = moveLine(order, from, to)
    setOrder(next)
    run(() => reorderSelectionChoices(projectId, row.id, next.map((choice) => choice.id)))
  }


  const names = new Map(rows.map((item) => [item.id, item.name]))
  const followUpOptions = rows.map((item) => ({ id: item.id, label: `${item.roomName} · ${item.name}` }))
  const panel = detail?.panel ?? null

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* The drawer header shows the selection's name, room and cost code. */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Status</span>
          {/* Keyed on the status so an automatic move or another edit shows after refresh. */}
          <ProjectSelectionStatusSelect
            key={`${row.status}:${row.replaced ? "replaced" : ""}`}
            projectId={projectId}
            selectionId={row.id}
            status={row.status}
            labels={statusLabels}
            replaced={row.replaced}
            onChanged={onChanged}
          />
        </div>
        {row.status === "approved" && (
          <span className="text-xs text-muted-foreground">{row.signed ? "Signed by the owner" : "Not signed by the owner yet"}</span>
        )}
        {detail?.replaces && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Replaces {detail.replaces.name}
              {detail.replaces.reason ? ` (${REPLACEMENT_REASON_LABELS[detail.replaces.reason].toLocaleLowerCase()})` : ""}.
            </span>
            {detail.replacementChangeOrder ? (
              <Link
                className="text-primary hover:underline"
                href={`/dashboard/projects/${encodeURIComponent(projectId)}/change-orders/${encodeURIComponent(detail.replacementChangeOrder.id)}`}
              >
                Change order {detail.replacementChangeOrder.number}
              </Link>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => createReplacementChangeOrder(projectId, row.id))}>
                Create change order
              </Button>
            )}
          </div>
        )}
        {detail?.lock && (
          <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
            <p>
              {detail.replacedBy ? <>Replaced by <b>{detail.replacedBy.name}</b>. </> : null}
              {detail.lock.message}
            </p>
            {!detail.replacedBy && (detail.lock.kind === "installed" || detail.lock.kind === "ordered") && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDialog({ kind: "replace", replaceKind: detail.lock?.kind === "installed" ? "installed" : "ordered" })}
                >
                  {detail.lock.kind === "installed" ? "Replace installed item" : "Owner changed selection after purchase"}
                </Button>
              </div>
            )}
          </div>
        )}
        <span className="text-sm">
          Allowance {row.allowanceCents !== null ? <b>{formatCents(row.allowanceCents)}</b> : <span className="text-muted-foreground">not published</span>}
          {row.dueDate && <> · due {formatDate(row.dueDate)}</>}
          {!row.published && <span className="text-muted-foreground"> · not shown to the owner yet</span>}
        </span>
        <SelectionRoundTemplateControls
          projectId={projectId}
          selectionId={row.id}
          selectionName={row.name}
          roundKey={row.roundKey}
          rounds={rounds}
          hasChoices={row.choiceCount > 0}
          onChanged={reload}
        />
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!panel ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Section title="Choices" aside={order.length > 1 ? <span className="text-xs text-muted-foreground">Drag to reorder</span> : undefined}>
            {order.length === 0 ? (
              <p className="text-sm text-muted-foreground">No choices yet. Add the options the owner can choose from.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <SortableRows ids={order.map((choice) => choice.id)} onMove={move} disabled={pending}>
                  {order.map((choice, index) => (
                    <SelectionChoiceCard
                      key={choice.id}
                      projectId={projectId}
                      choice={choice}
                      index={index}
                      allowanceCents={row.allowanceCents}
                      leadTimeWarning={leadTimeWarning?.choiceId === choice.id ? leadTimeWarning : null}
                      followUpNames={choice.dependentSelectionIds.flatMap((id) => names.get(id) ?? [])}
                      busy={pending}
                      onEdit={() => setDialog({ kind: "choice", choice })}
                      onTogglePick={() => (choice.chosen ? run(() => setSelectionChoiceChosen(projectId, choice.id, false)) : setDialog({ kind: "pick", choice }))}
                      onAddLink={() => setDialog({ kind: "link", choice })}
                      onAttachPhotos={() => setDialog({ kind: "photos", choice })}
                      onFollowUps={() => setDialog({ kind: "followUps", choice })}
                      onRemoveLink={(linkId) => run(() => deleteSelectionLink(projectId, row.id, linkId))}
                      onDelete={() => {
                        if (window.confirm(`Delete the choice "${choice.title}"? Its links and photo links go with it.`)) {
                          run(() => deleteSelectionChoice(projectId, choice.id))
                        }
                      }}
                    />
                  ))}
                </SortableRows>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ kind: "choice", choice: null })}>
                <IconPlus className="size-4" /> Add choice
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ kind: "link", choice: null })}>
                Paste product link
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={order.length === 0} onClick={() => setDialog({ kind: "price" })}>
                Ask supplier to price
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ kind: "photos", choice: null })}>
                Photos
              </Button>
            </div>
            {panel.selectionLinks.map((link) => (
              <SelectionLinkCard key={link.id} link={link} addedByOwner={link.addedByAudience === "owner"} onRemove={() => run(() => deleteSelectionLink(projectId, row.id, link.id))} />
            ))}
          </Section>

          <Section
            title="To-dos"
            aside={
              !todoFormOpen && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setTodoFormOpen(true)}>
                  <IconPlus className="size-4" /> To-do
                </Button>
              )
            }
          >
            {todoFormOpen && (
              <SelectionTodoForm
                defaultTitle={`Follow up on ${row.name}`}
                pending={pending}
                onCancel={() => setTodoFormOpen(false)}
                onSubmit={(title, dueDate) => {
                  setTodoFormOpen(false)
                  run(() =>
                    createProjectTask(projectId, {
                      title,
                      description: null,
                      sourceRecordType: "staff_task",
                      sourceRecordId: row.id,
                      sourceRecordNumber: null,
                      assigneeName: null,
                      companyName: null,
                      startDate: null,
                      dueDate,
                      priority: "normal",
                      externalUrl: null,
                    }),
                  )
                }}
              />
            )}
            {detail?.todos.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {detail.todos.map((todo) => (
                  <li key={todo.id} className="flex items-center justify-between gap-2">
                    <Link href={`/dashboard/projects/${encodeURIComponent(projectId)}/todos?item=${encodeURIComponent(todo.id)}`} className="min-w-0 truncate text-primary hover:underline">
                      {todo.number ? `${todo.number} · ` : ""}
                      {todo.title}
                    </Link>
                    <RecordStatusBadge label={todo.statusLabel} color={todo.statusColor} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No to-dos yet. Pricing, ordering and owner questions add them here.</p>
            )}
          </Section>

          {detail && detail.rfqs.length > 0 && (
            <Section title="RFQs">
              <ul className="flex flex-col gap-1 text-sm">
                {detail.rfqs.map((rfq) => (
                  <li key={rfq.id} className="flex items-center justify-between gap-2">
                    <Link href={`/dashboard/projects/${encodeURIComponent(projectId)}/rfqs?created=${encodeURIComponent(rfq.id)}`} className="min-w-0 truncate text-primary hover:underline">
                      {[rfq.number, rfq.companyName ?? rfq.title].filter(Boolean).join(" · ")}
                    </Link>
                    <span className="text-xs text-muted-foreground">{rfq.status.replaceAll("_", " ")}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Comments">
            <SelectionComments projectId={projectId} selectionId={row.id} audience="staff" comments={panel.comments} onChanged={reload} />
          </Section>
        </>
      )}

      <SelectionChoiceForm
        projectId={projectId}
        selectionId={row.id}
        choice={dialog.kind === "choice" ? dialog.choice : null}
        suppliers={suppliers}
        open={dialog.kind === "choice"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        onSaved={reload}
      />
      <PasteLinkDialog
        projectId={projectId}
        selectionId={row.id}
        choiceId={dialog.kind === "link" ? (dialog.choice?.id ?? null) : null}
        targetLabel={dialog.kind === "link" && dialog.choice ? dialog.choice.title : row.name}
        open={dialog.kind === "link"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        onSaved={reload}
      />
      <AttachPhotosDialog
        projectId={projectId}
        selectionId={row.id}
        choiceId={dialog.kind === "photos" ? (dialog.choice?.id ?? null) : null}
        targetLabel={dialog.kind === "photos" && dialog.choice ? dialog.choice.title : row.name}
        attached={
          dialog.kind !== "photos"
            ? []
            : dialog.choice
              ? (order.find((choice) => choice.id === dialog.choice?.id)?.photos ?? [])
              : (panel?.selectionPhotos ?? [])
        }
        open={dialog.kind === "photos"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        onSaved={reload}
      />
      {dialog.kind === "pick" && (
        <PickForOwnerDialog
          projectId={projectId}
          choiceId={dialog.choice.id}
          choiceTitle={dialog.choice.title}
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onSaved={reload}
        />
      )}
      {dialog.kind === "followUps" && (
        <FollowUpsDialog
          projectId={projectId}
          selectionId={row.id}
          choiceId={dialog.choice.id}
          choiceTitle={dialog.choice.title}
          current={dialog.choice.dependentSelectionIds}
          options={followUpOptions}
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onSaved={reload}
        />
      )}
      {dialog.kind === "replace" && (
        <SelectionReplaceDialog
          projectId={projectId}
          selectionId={row.id}
          selectionName={row.name}
          kind={dialog.replaceKind}
          choices={order}
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onSaved={reload}
        />
      )}
      <SelectionPriceRequest
        projectId={projectId}
        selectionId={row.id}
        choices={order}
        suppliers={suppliers}
        draftRfqs={detail?.draftRfqs ?? []}
        open={dialog.kind === "price"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
      />
    </div>
  )
}
