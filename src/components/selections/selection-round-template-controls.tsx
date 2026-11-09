"use client"

/*
 * In a selection's detail panel: which round it belongs to, applying a
 * company choice template to it, and saving its choices as a template.
 */
import * as React from "react"
import { toast } from "sonner"

import { applyChoiceTemplate, assignSelectionRound, getChoiceTemplates, saveSelectionAsTemplate } from "@/app/actions/selection-templates"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RoundCard } from "@/lib/domain/selections/rounds-server"
import type { ChoiceTemplateSummary } from "@/lib/domain/selections/templates"

const NO_ROUND = "__none__"

export function SelectionRoundTemplateControls({
  projectId,
  selectionId,
  selectionName,
  roundKey,
  rounds,
  hasChoices,
  onChanged,
}: {
  readonly projectId: string
  readonly selectionId: string
  readonly selectionName: string
  readonly roundKey: string | null
  readonly rounds: readonly RoundCard[]
  readonly hasChoices: boolean
  readonly onChanged: () => void
}): React.ReactElement {
  const [dialog, setDialog] = React.useState<"none" | "apply" | "save">("none")
  const [templates, setTemplates] = React.useState<readonly ChoiceTemplateSummary[] | null>(null)
  const [templateId, setTemplateId] = React.useState("")
  const [name, setName] = React.useState(selectionName)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (dialog !== "apply") return
    setError(null)
    setTemplateId("")
    void getChoiceTemplates(projectId).then((result) => {
      if (result.success) setTemplates(result.data)
      else setError(result.error)
    })
  }, [dialog, projectId])

  function chooseRound(value: string): void {
    startTransition(async () => {
      const result = await assignSelectionRound(projectId, [selectionId], value === NO_ROUND ? null : value)
      if (!result.success) toast.error(result.error)
      onChanged()
    })
  }

  function apply(): void {
    startTransition(async () => {
      const result = await applyChoiceTemplate(projectId, templateId, { kind: "selection", selectionId })
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.success(`Added ${result.data.count} choices.`)
      setDialog("none")
      onChanged()
    })
  }

  function save(): void {
    startTransition(async () => {
      const result = await saveSelectionAsTemplate(projectId, selectionId, name)
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.success(`Saved ${result.data.count} choices as "${name.trim()}".`)
      setDialog("none")
    })
  }

  const known = roundKey !== null && rounds.some((round) => round.key === roundKey)
  return (
    <div className="flex flex-wrap items-end gap-2">
      {rounds.length > 0 && (
        <div className="grid min-w-44 gap-1">
          <Label className="text-xs text-muted-foreground">Round</Label>
          <SearchableCombobox
            ariaLabel="Round"
            value={known && roundKey ? roundKey : NO_ROUND}
            onValueChange={chooseRound}
            disabled={pending}
            options={[{ value: NO_ROUND, label: "No round" }, ...rounds.map((round) => ({ value: round.key, label: round.name }))]}
            placeholder="No round"
          />
        </div>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => setDialog("apply")}>
        Apply template
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={!hasChoices} onClick={() => { setName(selectionName); setError(null); setDialog("save") }}>
        Save as template
      </Button>

      <Dialog open={dialog !== "none"} onOpenChange={(open) => !open && setDialog("none")}>
        <DialogContent className="sm:max-w-md">
          {dialog === "apply" ? (
            <>
              <DialogHeader>
                <DialogTitle>Apply a choice template</DialogTitle>
                <DialogDescription>The template&apos;s choices are added after this selection&apos;s own choices.</DialogDescription>
              </DialogHeader>
              {templates === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No templates yet. Use Choice templates above the sheet to import some.</p>
              ) : (
                <SearchableCombobox
                  ariaLabel="Template"
                  value={templateId}
                  onValueChange={setTemplateId}
                  options={templates.map((template) => ({
                    value: template.id,
                    label: `${template.name}${template.category ? ` · ${template.category}` : ""} (${template.itemCount})`,
                  }))}
                  placeholder="Choose a template"
                  searchPlaceholder="Search templates…"
                />
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog("none")}>
                  Cancel
                </Button>
                <Button type="button" disabled={pending || !templateId} onClick={apply}>
                  Add choices
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Save as template</DialogTitle>
                <DialogDescription>
                  Saves this selection&apos;s choices (prices, suppliers, lead times and product links) for any job. A template with the same name is replaced.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor="template-name">Template name</Label>
                <Input id="template-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog("none")}>
                  Cancel
                </Button>
                <Button type="button" disabled={pending || !name.trim()} onClick={save}>
                  Save template
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
