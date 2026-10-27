"use client"

import * as React from "react"
import { toast } from "sonner"
import { getCompanyFieldCostCodes, getProjectFieldCostCodes, resetCompanyFieldCostCodes, saveCompanyFieldCostCodes, saveProjectFieldCostCodes, type FieldCostCodeEditorView } from "@/app/actions/field-cost-codes"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import type { FieldCostCode } from "@/lib/field/cost-code-settings"

type Props = { readonly scope: "company" } | { readonly scope: "project"; readonly projectId: string }

/** Deliberate Field-only selections, separate from Full Compass's catalog and search. */
export function FieldCostCodeEditor(props: Props): React.ReactElement {
  const projectId = props.scope === "project" ? props.projectId : null
  const [view, setView] = React.useState<FieldCostCodeEditorView | null>(null)
  const [codes, setCodes] = React.useState<readonly FieldCostCode[]>([])
  const [selected, setSelected] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [confirmation, setConfirmation] = React.useState<"save" | "reset" | null>(null)
  const [pending, startTransition] = React.useTransition()
  const id = projectId ? "project-field-cost-codes" : "company-field-cost-codes"
  const title = projectId ? "Additional Field Mode cost codes" : "Field Mode default cost codes"

  const load = React.useCallback(async (): Promise<void> => {
    const result = projectId ? await getProjectFieldCostCodes(projectId) : await getCompanyFieldCostCodes()
    if (!result.success) { setError(result.error); return }
    setView(result.data)
    setCodes(result.data.codes)
    setError(null)
  }, [projectId])
  React.useEffect(() => { void load() }, [load])

  const changed = view !== null && JSON.stringify(codes) !== JSON.stringify(view.codes)
  const disabled = pending || !view?.canEdit
  const selectedCodes = new Set([...codes, ...(projectId ? view?.inherited ?? [] : [])].map((code) => code.code))
  const choices = (view?.choices ?? []).filter((code) => !selectedCodes.has(code.code)).map((code) => ({ value: code.code, label: `${code.code} ${code.name}` }))

  function add(): void {
    const code = view?.choices.find((choice) => choice.code === selected)
    if (code && !selectedCodes.has(code.code)) setCodes((current) => [...current, code])
    setSelected("")
  }
  function save(): void {
    const operation = confirmation
    if (!operation || !view?.canEdit) return
    startTransition(async () => {
      const result = projectId
        ? await saveProjectFieldCostCodes(projectId, operation === "reset" ? [] : codes.map((code) => code.code))
        : operation === "reset" ? await resetCompanyFieldCostCodes() : await saveCompanyFieldCostCodes(codes.map((code) => code.code))
      if (!result.success) { toast.error(result.error); return }
      setConfirmation(null)
      toast.success(projectId ? "Project Field Mode codes saved. Refresh the project in Field Mode." : "Field Mode defaults saved. Refresh downloaded projects to apply them.")
      await load()
    })
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 border-t pt-5">
      <div>
        <h2 id={`${id}-title`} className="font-semibold">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {projectId ? "Add specific codes for this project only. Company defaults and phone-enabled duties stay included; other projects are unchanged."
            : "Choose the default codes crews can select in Field Mode. These apply to job departments enabled in Daily logs. Internal workspaces keep their phone-enabled duties."}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Full Compass keeps its broader catalog and search. Field Mode picks up saved changes when downloaded project data is refreshed.</p>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!view ? <p className="text-sm text-muted-foreground">{error ? "Field cost-code settings could not be loaded." : "Loading Field cost-code settings…"}</p> : (
        <>
          {!projectId && !view.customized ? <p className="text-sm text-muted-foreground">Using the existing configured crew list. Saving this list makes Field Mode defaults independent of later labor-list changes.</p> : null}
          {!projectId && view.combinesDepartmentLists ? <p role="status" className="max-w-3xl text-sm text-muted-foreground">Enabled departments currently have different crew lists. Saving these defaults combines them into the same list for all enabled job departments.</p> : null}
          {projectId ? (
            <details className="max-w-3xl border-y py-3">
              <summary className="cursor-pointer text-sm">Included defaults and duties ({view.inherited.length})</summary>
              <ul className="mt-2 max-h-56 overflow-y-auto text-sm">
                {view.inherited.map((code) => <li key={code.code} className="py-1"><span className="font-mono">{code.code}</span> {code.name}</li>)}
              </ul>
            </details>
          ) : null}
          <p className="text-sm">{codes.length} {projectId ? "project additions" : "default codes"}</p>
          {codes.length ? <ul className="max-h-80 max-w-3xl divide-y overflow-y-auto border-y">
            {codes.map((code) => <li key={code.code} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span><span className="font-mono">{code.code}</span> {code.name}</span>
              {view.canEdit ? <Button type="button" variant="ghost" size="sm" disabled={pending} aria-label={`Remove ${code.code} from ${projectId ? "project additions" : "Field Mode defaults"}`} onClick={() => setCodes((current) => current.filter((item) => item.code !== code.code))}>Remove</Button> : null}
            </li>)}
          </ul> : <p className="text-sm text-muted-foreground">{projectId ? "No additional codes. This project follows its included defaults and duties." : "No default codes selected. Jobs will only offer their explicit project additions."}</p>}
          {view.canEdit ? <>
            <div className="grid max-w-3xl gap-2">
              <Label htmlFor={`${id}-add`}>Cost code to add</Label>
              <div className="flex items-center gap-2">
                <SearchableCombobox id={`${id}-add`} ariaLabel={`Add ${projectId ? "project" : "default"} Field Mode cost code`} options={choices} value={selected} onValueChange={setSelected} placeholder="Choose a company cost code" searchPlaceholder="Search company cost codes..." emptyMessage="No additional codes available." disabled={disabled || codes.length >= 300} />
                <Button type="button" variant="outline" disabled={disabled || !selected || codes.length >= 300} onClick={add}>Add code</Button>
              </div>
            </div>
            <div className="flex max-w-3xl flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={pending || !view.customized} onClick={() => setConfirmation("reset")}>{projectId ? "Remove project additions" : "Reset to crew defaults"}</Button>
              <Button type="button" disabled={pending || (!changed && (projectId !== null || view.customized))} onClick={() => setConfirmation("save")}>{projectId ? "Save project additions" : "Save Field Mode defaults"}</Button>
            </div>
          </> : <p className="text-xs text-muted-foreground">{projectId ? "Project managers and company admins can change these additions." : "Company admins can change Field Mode defaults."}</p>}
        </>
      )}
      <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !pending) setConfirmation(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation === "reset" ? projectId ? "Remove this project's additional Field codes?" : "Reset Field Mode defaults to the crew list?" : projectId ? "Save this project's additional Field codes?" : "Save company Field Mode defaults?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {projectId ? "Only this project's additional Field Mode choices will change. Included company defaults and phone-enabled duties remain."
                : "This changes the default codes offered on all eligible jobs. Explicit project additions remain."}{!projectId && confirmation === "save" && view?.combinesDepartmentLists ? " The current department lists will be combined into one shared default list." : ""} Existing log records are preserved. Refresh downloaded projects in Field Mode after saving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); save() }}>{pending ? "Saving…" : confirmation === "reset" ? "Confirm reset" : "Confirm save"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
