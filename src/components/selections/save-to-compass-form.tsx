"use client"

/*
 * The "Save to Compass" popup form: the product page's preview card, then
 * job, selection (or a new one), choice title and supplier price. Saving
 * adds the choice and attaches the page as its supplier link through the
 * same actions the selection panel uses, then offers a link to the job's
 * selections and a Close button for the popup window.
 */
import * as React from "react"
import Link from "next/link"

import { createProjectSelection, getProjectSelections } from "@/app/actions/project-selections"
import { saveChoiceFromLink } from "@/app/actions/selection-choices"
import { ProjectCombobox } from "@/components/projects/project-combobox"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { SelectionLinkCard } from "@/components/selections/selection-link-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { LinkPreview } from "@/lib/selections/link-preview"
import { projectNumberAndName } from "@/lib/project-display-name"
import {
  centsToPriceInput,
  prefilledChoiceTitle,
  saveTargetSelections,
  type SaveTargetSelection,
} from "@/lib/selections/save-to-compass"

const NEW_SELECTION = "__new__"

type Job = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
}

type Selections =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly items: readonly SaveTargetSelection[] }
  | { readonly state: "error"; readonly error: string }

type Saved = { readonly jobLabel: string; readonly selectionName: string; readonly href: string }

function jobLabel(job: Job): string {
  return job.projectNumber ? projectNumberAndName(job, " - ") : job.name
}

export function SaveToCompassForm({
  url,
  pageTitle,
  preview,
  jobs,
}: {
  readonly url: string
  readonly pageTitle: string
  readonly preview: LinkPreview
  readonly jobs: readonly Job[]
}): React.ReactElement {
  const formId = React.useId()
  const [jobId, setJobId] = React.useState("")
  const [selections, setSelections] = React.useState<Selections>({ state: "idle" })
  const [selectionId, setSelectionId] = React.useState("")
  const [newName, setNewName] = React.useState("")
  const [newRoom, setNewRoom] = React.useState("")
  const [newCategory, setNewCategory] = React.useState("")
  const [title, setTitle] = React.useState(() => prefilledChoiceTitle(preview.title, pageTitle))
  const [price, setPrice] = React.useState(() => centsToPriceInput(preview.priceCents))
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<Saved | null>(null)
  const [pending, startTransition] = React.useTransition()

  const loadSelections = React.useCallback(async (projectId: string) => {
    setSelections({ state: "loading" })
    try {
      const summary = await getProjectSelections(projectId)
      setSelections({ state: "ready", items: saveTargetSelections(summary.rooms) })
    } catch (loadError) {
      setSelections({ state: "error", error: loadError instanceof Error ? loadError.message : "Unable to load this job's selections." })
    }
  }, [])

  function chooseJob(value: string): void {
    setJobId(value)
    setSelectionId("")
    setError(null)
    if (value) void loadSelections(value)
    else setSelections({ state: "idle" })
  }

  const items = React.useMemo(() => (selections.state === "ready" ? selections.items : []), [selections])
  const selectionOptions = React.useMemo(
    () => [
      ...items.map((item) => ({
        value: item.id,
        label: item.name,
        description: `${item.roomName} · ${item.category}`,
        keywords: `${item.roomName} ${item.category}`,
      })),
      { value: NEW_SELECTION, label: "New selection…", description: "Add a selection to this job" },
    ],
    [items],
  )
  const creatingSelection = selectionId === NEW_SELECTION

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const job = jobs.find((item) => item.id === jobId)
    if (!job) return setError("Choose a job.")
    if (!selectionId) return setError("Choose a selection.")
    setError(null)
    startTransition(async () => {
      let targetId = selectionId
      let targetName = items.find((item) => item.id === selectionId)?.name ?? ""
      if (creatingSelection) {
        const created = await createProjectSelection(job.id, {
          roomName: newRoom,
          roomType: null,
          category: newCategory,
          name: newName,
          description: null,
          quantity: null,
          manufacturer: null,
          model: null,
          colorFinish: null,
          supplierName: null,
          productUrl: null,
          costCode: null,
          phaseCode: null,
          status: null,
          notes: null,
        })
        if (!created.success) return setError(created.error)
        if (!created.id) return setError("Unable to create the selection.")
        targetId = created.id
        targetName = newName.trim()
        // The new selection now exists; a retry should pick it rather than add another.
        setSelectionId(created.id)
        void loadSelections(job.id)
      }
      const result = await saveChoiceFromLink(job.id, targetId, { title, price }, url)
      if (!result.success) return setError(result.error)
      setSaved({
        jobLabel: jobLabel(job),
        selectionName: targetName,
        href: `/dashboard/projects/${encodeURIComponent(job.id)}/selections?selection=${encodeURIComponent(targetId)}`,
      })
    })
  }

  const linkCard = (
    <SelectionLinkCard
      link={{
        id: "preview",
        choiceId: null,
        url,
        title: preview.title ?? (pageTitle || null),
        imageUrl: preview.imageUrl,
        priceCents: preview.priceCents,
        siteName: preview.siteName,
        addedByAudience: "staff",
      }}
    />
  )

  if (saved) {
    return (
      <div className="grid gap-4">
        {linkCard}
        <p className="text-sm" role="status">
          Saved to <span className="font-medium">{saved.jobLabel}</span> › <span className="font-medium">{saved.selectionName}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={saved.href} target="_blank" rel="noopener">
              Open selection
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => window.close()}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form id={formId} onSubmit={submit} className="grid gap-4">
      {linkCard}
      <div className="grid gap-1.5">
        <Label htmlFor={`${formId}-job`}>Job</Label>
        <ProjectCombobox
          id={`${formId}-job`}
          projects={jobs}
          value={jobId}
          onValueChange={chooseJob}
          ariaLabel="Job"
          placeholder="Choose an open job"
          emptyMessage="No open or warranty jobs match."
        />
        {jobs.length === 0 && <p className="text-xs text-muted-foreground">You have no open or warranty jobs.</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${formId}-selection`}>Selection</Label>
        <SearchableCombobox
          id={`${formId}-selection`}
          ariaLabel="Selection"
          value={selectionId}
          onValueChange={setSelectionId}
          options={selectionOptions}
          placeholder={selections.state === "loading" ? "Loading selections…" : jobId ? "Choose a selection" : "Choose a job first"}
          searchPlaceholder="Search selections, rooms, categories…"
          emptyMessage="No matching selections."
          disabled={selections.state !== "ready"}
        />
        {selections.state === "error" && <p className="text-xs text-destructive">{selections.error}</p>}
      </div>
      {creatingSelection && (
        <fieldset className="grid gap-3 border-l-2 pl-3">
          <legend className="sr-only">New selection</legend>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-new-name`}>Selection name</Label>
            <Input id={`${formId}-new-name`} required maxLength={200} value={newName} onChange={(event) => setNewName(event.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-new-room`}>Room</Label>
              <Input
                id={`${formId}-new-room`}
                required
                maxLength={200}
                list={`${formId}-rooms`}
                value={newRoom}
                onChange={(event) => setNewRoom(event.target.value)}
              />
              <datalist id={`${formId}-rooms`}>
                {[...new Set(items.map((item) => item.roomName))].map((room) => (
                  <option key={room} value={room} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-new-category`}>Category</Label>
              <Input
                id={`${formId}-new-category`}
                maxLength={200}
                list={`${formId}-categories`}
                placeholder="Uncategorized"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
              />
              <datalist id={`${formId}-categories`}>
                {[...new Set(items.map((item) => item.category))].map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </div>
          </div>
        </fieldset>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${formId}-title`}>Choice name</Label>
        <Input id={`${formId}-title`} required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${formId}-price`}>Supplier price</Label>
        <Input id={`${formId}-price`} inputMode="decimal" placeholder="0.00" value={price} onChange={(event) => setPrice(event.target.value)} />
        <p className="text-xs text-muted-foreground">Read from the page when it lists one. Check it before saving.</p>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !jobId || !selectionId}>
          {pending ? "Saving…" : "Save choice"}
        </Button>
        <Button type="button" variant="outline" onClick={() => window.close()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
