"use client"

import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod/v4"
import { Bookmark, Check, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { deleteProjectView, saveProjectView, setDefaultProjectView } from "@/app/actions/project-views"
import { useProjectViewPreferences } from "@/components/project-list-provider"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sameProjectView, type ProjectViewDefinition, type SavedProjectView } from "@/lib/project-views"

const formSchema = z.object({ name: z.string().trim().min(1, "Enter a view name.").max(80), shared: z.boolean(), replaceFilters: z.boolean() })
type ViewForm = z.infer<typeof formSchema>

export function ProjectViewControls({ definition, filterSummary, views, loadError, onApply }: {
  readonly definition: ProjectViewDefinition
  readonly filterSummary: string
  readonly views: readonly SavedProjectView[]
  readonly loadError: string | null
  readonly onApply: (definition: ProjectViewDefinition) => void
}): React.ReactElement {
  const preferences = useProjectViewPreferences()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SavedProjectView | null>(null)
  const [deleting, setDeleting] = useState<SavedProjectView | null>(null)
  const form = useForm<ViewForm>({ resolver: zodResolver(formSchema), defaultValues: { name: "", shared: false, replaceFilters: false } })
  const selectedView = views.find((view) => sameProjectView(view.definition, definition))
  const isDefault = preferences.defaultDefinition !== null && sameProjectView(preferences.defaultDefinition, definition)
  const canManageViews = preferences.canSave && loadError === null

  function run(task: () => Promise<void>): void {
    startTransition(async () => {
      try { await task() } catch { toast.error("Unable to reach Compass. Please try again.") }
    })
  }

  function edit(view: SavedProjectView | null): void {
    setEditing(view)
    form.reset({ name: view?.name ?? "", shared: view?.visibility === "shared", replaceFilters: false })
    setDialogOpen(true)
  }

  const save = form.handleSubmit((values) => run(async () => {
    const result = await saveProjectView({
      id: editing?.id ?? null,
      name: values.name,
      visibility: values.shared ? "shared" : "personal",
      definition: editing && !values.replaceFilters ? editing.definition : definition,
    })
    if (!result.success) { toast.error(result.error); return }
    toast.success(editing ? "View updated." : "View saved.")
    setDialogOpen(false)
  }))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!preferences.canSave || isPending || isDefault}
          onClick={() => run(async () => {
            const result = await setDefaultProjectView(definition)
            if (!result.success) { toast.error(result.error); return }
            toast.success("Default saved for All Projects and the project selector.")
          })}>
          {isDefault ? <Check className="size-4" /> : <Bookmark className="size-4" />}
          {isDefault ? "Your default" : "Set as default"}
        </Button>
        {preferences.defaultDefinition !== null ? (
          <Button type="button" variant="ghost" size="sm" disabled={isPending || !preferences.canSave}
            onClick={() => run(async () => {
              const result = await setDefaultProjectView(null)
              if (!result.success) { toast.error(result.error); return }
              toast.success("Personal default reset.")
            })}>Reset default</Button>
        ) : null}
        <div className="min-w-0 w-full sm:w-48">
          <SearchableCombobox ariaLabel="Saved project views" placeholder="Saved views" searchPlaceholder="Search saved views..."
            options={views.map((view) => ({ value: view.id, label: view.name, description: view.isOwner ? view.visibility === "shared" ? "Yours · shared with staff" : "Personal" : "Shared · read-only" }))}
            value={selectedView?.id ?? ""} onValueChange={(id) => {
              const view = views.find((item) => item.id === id)
              if (view) onApply(view.definition)
            }} className="h-8" />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!canManageViews || isPending} onClick={() => edit(null)}>{views.length > 0 ? "Save / manage…" : "Save view…"}</Button>
      </div>
      {preferences.error || loadError ? <p role="status" className="text-xs text-destructive">{preferences.error ?? loadError}</p> : null}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!isPending) setDialogOpen(open) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit project view" : "Save project view"}</DialogTitle>
            <DialogDescription>Views belong to you. Sharing lets internal staff use a view without changing their defaults.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-view-name">View name</Label>
              <Input id="project-view-name" maxLength={80} disabled={isPending} {...form.register("name")} aria-invalid={Boolean(form.formState.errors.name)} aria-describedby="project-view-name-error" />
              <p id="project-view-name-error" className="text-xs text-destructive">{form.formState.errors.name?.message}</p>
            </div>
            <p className="text-xs text-muted-foreground">{editing && !form.watch("replaceFilters") ? "Keeping this view’s saved filters." : `Current filters: ${filterSummary}.`} Search text is never saved.</p>
            {editing ? <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.watch("replaceFilters")} disabled={isPending} onCheckedChange={(value) => form.setValue("replaceFilters", value === true)} />
              Replace saved filters with the current filters
            </label> : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.watch("shared")} disabled={isPending} onCheckedChange={(value) => form.setValue("shared", value === true)} />
              Share with internal staff in my organization
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : editing ? "Save changes" : "Save view"}</Button>
            </DialogFooter>
          </form>
          {views.length > 0 ? <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Available views</p>
            <div className="max-h-52 overflow-y-auto divide-y">
              {views.map((view) => <div key={view.id} className="flex items-center gap-2 py-2">
                <Button type="button" variant="ghost" className="h-auto min-w-0 flex-1 justify-start whitespace-normal break-words text-left" disabled={isPending} onClick={() => { onApply(view.definition); setDialogOpen(false) }}>{view.name}</Button>
                <span className="text-xs text-muted-foreground">{view.visibility === "shared" ? "Shared" : "Personal"}</span>
                {view.isOwner ? <>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${view.name}`} disabled={isPending} onClick={() => edit(view)}><Pencil className="size-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${view.name}`} disabled={isPending} onClick={() => setDeleting(view)}><Trash2 className="size-4" /></Button>
                </> : <span className="text-xs text-muted-foreground">Read-only</span>}
              </div>)}
            </div>
          </div> : null}
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open && !isPending) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This removes the saved view{deleting?.visibility === "shared" ? " for everyone it is shared with" : ""}. Personal defaults already saved from it will stay in place.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={(event) => {
              event.preventDefault()
              const view = deleting
              if (!view) return
              run(async () => {
                const result = await deleteProjectView(view.id)
                if (!result.success) { toast.error(result.error); return }
                setDeleting(null)
                if (editing?.id === view.id) edit(null)
                toast.success("View deleted.")
              })
            }}>Delete view</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
