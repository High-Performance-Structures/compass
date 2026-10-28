"use client"

import * as React from "react"
import { toast } from "sonner"
import { getFeatureSettingsForEditor, saveFeatureSettings, resetFeatureSettings } from "@/app/actions/feature-settings"
import { archiveDeliverySettingsSchema } from "@/lib/feature-settings/registry"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DriveBrowseDialog } from "@/components/google/drive-browse-dialog"

/** Adds browsed Drive folders' ids to a one-id-per-line list. */
function AddFoldersButton({ title, value, onChange, disabled }: { readonly title: string; readonly value: string; readonly onChange: (next: string) => void; readonly disabled: boolean }): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const ids = value.split(/[\s,]+/).filter(Boolean)
  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>Add folders…</Button>
      <DriveBrowseDialog
        open={open}
        onOpenChange={setOpen}
        choose="folder"
        multiple
        title={title}
        alreadyChosenIds={ids}
        onPick={(items) => onChange([...ids, ...items.map((item) => item.id).filter((id) => !ids.includes(id))].join("\n"))}
      />
    </>
  )
}

export function ArchiveDeliverySettingsSection(): React.ReactElement {
  const [roots, setRoots] = React.useState("")
  const [excluded, setExcluded] = React.useState("")
  const [canEdit, setCanEdit] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("archive-delivery")
    if (!result.success) { setError(result.error); return }
    const parsed = archiveDeliverySettingsSchema.safeParse(result.data.settings)
    if (!parsed.success) { setError("Archive settings are invalid."); return }
    setRoots(parsed.data.deliveryRootIds.join("\n"))
    setExcluded(parsed.data.excludedMasterRootIds.join("\n"))
    setCanEdit(result.data.canEdit)
  }, [])
  React.useEffect(() => { void load() }, [load])
  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveFeatureSettings("archive-delivery", { deliveryRootIds: roots.split(/[\s,]+/).filter(Boolean), excludedMasterRootIds: excluded.split(/[\s,]+/).filter(Boolean) })
      if (!result.success) { toast.error(result.error); return }
      toast.success("Archive delivery settings saved")
      await load()
    })
  }
  return <section className="space-y-4 border-b pb-6"><h2 className="text-base font-semibold">Buildertrend Archive delivery</h2><p className="max-w-3xl text-sm text-muted-foreground">Only reviewed PDF editions placed in private delivery folders can be published to named project accounts. Files and their full parent folder chain must be private to the connected Google account. Internal master folders are always excluded, even if a delivery folder is nested inside one.</p>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<form onSubmit={save} className="max-w-2xl space-y-4"><div className="space-y-1"><Label htmlFor="archive-delivery-roots">Private delivery folder IDs</Label><Textarea id="archive-delivery-roots" value={roots} onChange={(event) => setRoots(event.target.value)} disabled={!canEdit || pending} /><AddFoldersButton title="Private delivery folders" value={roots} onChange={setRoots} disabled={!canEdit || pending} /><p className="text-xs text-muted-foreground">Add folders by browsing; each is kept as one Drive folder ID per line. Empty disables archive delivery.</p></div><div className="space-y-1"><Label htmlFor="archive-excluded-roots">Excluded internal master folder IDs</Label><Textarea id="archive-excluded-roots" value={excluded} onChange={(event) => setExcluded(event.target.value)} disabled={!canEdit || pending} /><AddFoldersButton title="Excluded internal master folders" value={excluded} onChange={setExcluded} disabled={!canEdit || pending} /><p className="text-xs text-muted-foreground">Required before enabling delivery. Keep internal reading masters and recovery files here.</p></div>{canEdit ? <div className="flex gap-2"><Button size="sm" disabled={pending}>Save</Button><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(async () => { const result = await resetFeatureSettings("archive-delivery"); if (!result.success) { toast.error(result.error); return }; await load(); toast.success("Archive delivery disabled") })}>Disable delivery</Button></div> : <p className="text-sm text-muted-foreground">Only administrators can change archive delivery settings.</p>}</form></section>
}
