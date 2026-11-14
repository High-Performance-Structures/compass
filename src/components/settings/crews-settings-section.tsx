"use client"

import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { deleteCrewSettings, getCrewSettings, saveCrewSettings, type CrewSettings } from "@/app/actions/crews"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Crew } from "@/lib/domain/identity/crews"
import { PROJECT_DEPARTMENTS, type ProjectDepartmentCode } from "@/lib/domain/project/statuses"

type Draft = {
  readonly id: string | null
  readonly name: string
  readonly department: ProjectDepartmentCode | null
  readonly leadUserId: string | null
  readonly memberIds: readonly string[]
}

const NONE = "__none__"
const EMPTY_DRAFT: Draft = { id: null, name: "", department: null, leadUserId: null, memberIds: [] }

/** Settings › People: crews of the company's own staff that schedule items can be assigned to. */
export function CrewsSettingsSection(): React.ReactElement {
  const profiles = useDepartmentProfiles()
  const [settings, setSettings] = React.useState<CrewSettings | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [deleting, setDeleting] = React.useState<Crew | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getCrewSettings()
    if (result.success) setSettings(result.data)
    else setError(result.error)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const staffName = (id: string): string =>
    settings?.staff.find((person) => person.id === id)?.name ??
    settings?.memberNames.find((person) => person.id === id)?.name ?? "Former staff"
  // Members no longer in the staff picker (deactivated or development accounts) stay listed so they can be removed.
  const memberOptions = draft
    ? [...(settings?.staff ?? []), ...draft.memberIds
      .filter((id) => !(settings?.staff ?? []).some((person) => person.id === id))
      .map((id) => ({ id, name: staffName(id) }))]
    : []

  function save(): void {
    if (!draft) return
    startTransition(async () => {
      const result = await saveCrewSettings({ ...draft, memberIds: [...draft.memberIds] })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(draft.id ? "Crew saved." : "Crew added.")
      setDraft(null)
      await load()
    })
  }

  function remove(crew: Crew): void {
    startTransition(async () => {
      const result = await deleteCrewSettings(crew.id)
      if (!result.success) toast.error(result.error)
      else toast.success(`${crew.name} deleted. Its schedule items keep the name.`)
      setDeleting(null)
      await load()
    })
  }

  function toggleMember(id: string, checked: boolean): void {
    setDraft((current) => {
      if (!current) return current
      const memberIds = checked ? [...current.memberIds, id] : current.memberIds.filter((memberId) => memberId !== id)
      return { ...current, memberIds, leadUserId: memberIds.includes(current.leadUserId ?? "") ? current.leadUserId : null }
    })
  }

  return (
    <section aria-labelledby="crew-settings" className="space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="crew-settings" className="text-base font-semibold">Crews</h2>
          <p className="text-sm text-muted-foreground">
            Groups of your own staff. Assign a schedule item to a crew and everyone on it sees it.
          </p>
        </div>
        {settings?.canEdit ? (
          <Button size="sm" onClick={() => setDraft(EMPTY_DRAFT)}>
            <IconPlus className="size-4" /> New crew
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {settings && settings.crews.length === 0 ? <p className="text-sm text-muted-foreground">No crews yet.</p> : null}
      {settings && settings.crews.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {settings.crews.map((crew) => (
            <li key={crew.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{crew.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    crew.department ? profiles[crew.department].shortName : "No department",
                    crew.leadUserId ? `Lead ${staffName(crew.leadUserId)}` : null,
                    crew.memberIds.length === 1 ? "1 person" : `${crew.memberIds.length} people`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {settings.canEdit ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft({ ...crew })}>Edit</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(crew)}>Delete</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit crew" : "New crew"}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="crew-name">Name</Label>
                  <Input id="crew-name" value={draft.name} maxLength={60} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="crew-department">Department</Label>
                  <Select
                    value={draft.department ?? NONE}
                    onValueChange={(value) => setDraft({ ...draft, department: PROJECT_DEPARTMENTS.find((code) => code === value) ?? null })}
                  >
                    <SelectTrigger id="crew-department"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No department</SelectItem>
                      {PROJECT_DEPARTMENTS.map((code) => (
                        <SelectItem key={code} value={code}>{profiles[code].shortName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">Members (staff only)</legend>
                <div className="max-h-56 overflow-y-auto rounded-lg border p-2">
                  {memberOptions.map((person) => (
                    <label key={person.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                      <Checkbox checked={draft.memberIds.includes(person.id)} onCheckedChange={(checked) => toggleMember(person.id, checked === true)} />
                      {person.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-1.5">
                <Label htmlFor="crew-lead">Crew lead</Label>
                <Select value={draft.leadUserId ?? NONE} onValueChange={(value) => setDraft({ ...draft, leadUserId: value === NONE ? null : value })}>
                  <SelectTrigger id="crew-lead"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No lead</SelectItem>
                    {draft.memberIds.map((id) => (
                      <SelectItem key={id} value={id}>{staffName(id)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={pending}>Cancel</Button>
            <Button onClick={save} disabled={pending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => (open ? null : setDeleting(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Schedule items assigned to this crew keep its name but no longer reach its members. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => (deleting ? remove(deleting) : undefined)}>Delete crew</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
