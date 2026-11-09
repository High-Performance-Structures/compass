"use client"

/*
 * The company's choice templates, from a job's Selections page: apply a
 * template to every selection on this job in its category, delete one, or
 * import templates from a CSV file (previewed before it's saved). Saving a
 * selection's choices as a template, and applying one to a single
 * selection, are in the selection's detail panel.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { applyChoiceTemplate, deleteChoiceTemplate, getChoiceTemplates, importChoiceTemplatesCsv } from "@/app/actions/selection-templates"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { ChoiceTemplateSummary } from "@/lib/domain/selections/templates"
import { parseChoiceTemplateCsv } from "@/lib/selections/choice-template-csv"

const CSV_COLUMNS = "Template, Category, Title, Description, Supplier, Supplier price, Owner price, Lead time days, Product URL"

export function ChoiceTemplatesDialog({ projectId }: { readonly projectId: string }): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [templates, setTemplates] = React.useState<readonly ChoiceTemplateSummary[] | null>(null)
  const [csv, setCsv] = React.useState<{ readonly name: string; readonly text: string } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const fileId = React.useId()

  const load = React.useCallback(async () => {
    const result = await getChoiceTemplates(projectId)
    if (result.success) setTemplates(result.data)
    else setError(result.error)
  }, [projectId])

  React.useEffect(() => {
    if (open) {
      setError(null)
      setCsv(null)
      void load()
    }
  }, [open, load])

  const preview = React.useMemo(() => (csv ? parseChoiceTemplateCsv(csv.text) : null), [csv])

  async function pickFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > 2_000_000) {
      setError("The file is too large. Split it into smaller files.")
      return
    }
    setCsv({ name: file.name, text: await file.text() })
  }

  function importCsv(): void {
    if (!csv) return
    startTransition(async () => {
      const result = await importChoiceTemplatesCsv(projectId, csv.text)
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.success(`Imported ${result.data.templates} template${result.data.templates === 1 ? "" : "s"} (${result.data.choices} choices).`)
      setCsv(null)
      await load()
    })
  }

  function apply(template: ChoiceTemplateSummary): void {
    startTransition(async () => {
      const result = await applyChoiceTemplate(projectId, template.id, { kind: "category" })
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.success(`Added ${result.data.count} choices from ${template.name}.`)
      router.refresh()
    })
  }

  function remove(template: ChoiceTemplateSummary): void {
    if (!window.confirm(`Delete the template "${template.name}"? Choices already added to jobs stay.`)) return
    startTransition(async () => {
      const result = await deleteChoiceTemplate(projectId, template.id)
      if (!result.success) setError(result.error)
      else await load()
    })
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Choice templates
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choice templates</DialogTitle>
            <DialogDescription>
              Your company&apos;s reusable sets of choices. Apply one to every selection on this job in its category, or open a selection to apply one there or save its choices as a template.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto">
            {templates === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No templates yet. Save a selection&apos;s choices as one, or import a CSV file.</p>
            ) : (
              <ul className="divide-y">
                {templates.map((template) => (
                  <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{template.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {" · "}
                        {template.category ?? "No category"} · {template.itemCount} choice{template.itemCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <Button type="button" variant="outline" size="sm" disabled={pending || !template.category} onClick={() => apply(template)}
                        title={template.category ? `Add to every ${template.category} selection on this job` : "Give the template a category to apply it to a job"}>
                        Apply to job
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => remove(template)}>
                        Delete
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t pt-3">
            <Label htmlFor={fileId}>Import from CSV</Label>
            <p className="text-xs text-muted-foreground">
              One row per choice. Columns: {CSV_COLUMNS}. Template and Title are required; rows with the same template name make one template. Importing a name you already have replaces it.
            </p>
            <input id={fileId} type="file" accept=".csv,text/csv" onChange={(event) => void pickFile(event)} className="text-sm" />
            {preview && csv && (
              <div className="flex flex-col gap-1 text-sm">
                <span>
                  {csv.name}: {preview.templates.length} template{preview.templates.length === 1 ? "" : "s"},{" "}
                  {preview.templates.reduce((total, template) => total + template.items.length, 0)} choices
                </span>
                {preview.errors.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-destructive">
                    {preview.errors.slice(0, 8).map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                    {preview.errors.length > 8 && <li>…and {preview.errors.length - 8} more</li>}
                  </ul>
                )}
                <span>
                  <Button type="button" size="sm" disabled={pending || preview.templates.length === 0} onClick={importCsv}>
                    Import {preview.templates.length || ""}
                  </Button>
                </span>
              </div>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
    </>
  )
}
