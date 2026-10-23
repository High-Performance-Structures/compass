"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getSavedScheduleTemplates,
  saveScheduleAsTemplate,
  type SavedScheduleTemplateOption,
} from "@/app/actions/schedule-template-export"
import { clearScheduleTemplateImportOptions } from "@/components/schedule/schedule-template-import-options-client"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"

type SaveMode = "new" | "update"

type ScheduleSaveTemplateDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly projectId: string
  readonly projectName: string
  readonly itemCount: number
  readonly dependencyCount: number
}

export function ScheduleSaveTemplateDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  itemCount,
  dependencyCount,
}: ScheduleSaveTemplateDialogProps) {
  const [mode, setMode] = useState<SaveMode>("new")
  const [savedTemplates, setSavedTemplates] = useState<
    readonly SavedScheduleTemplateOption[]
  >([])
  const [replaceTemplateId, setReplaceTemplateId] = useState("")
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [description, setDescription] = useState("")
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setMode("new")
    setReplaceTemplateId("")
    setName(projectName ? `${projectName} schedule` : "")
    setCategory("")
    setDescription("")
    setSavedTemplateId(null)
    getSavedScheduleTemplates()
      .then((templates) => {
        if (!cancelled) setSavedTemplates(templates)
      })
      .catch((error: unknown) => {
        console.error("Unable to load saved schedule templates", error)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectName])

  const canSave =
    itemCount > 0 &&
    !isSaving &&
    (mode === "new" ? name.trim().length >= 2 : replaceTemplateId.length > 0)

  function handleSave(): void {
    if (!canSave) return
    startSaving(async () => {
      const result = await saveScheduleAsTemplate({
        projectId,
        name: mode === "new" ? name : "",
        category,
        description,
        replaceTemplateId: mode === "update" ? replaceTemplateId : null,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      clearScheduleTemplateImportOptions()
      setSavedTemplateId(result.templateId)
      toast.success(
        `Saved ${result.itemCount} schedule items and ${result.dependencyCount} predecessors` +
          (result.versionNumber > 1 ? ` as version ${result.versionNumber}.` : ".")
      )
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Save schedule as template</DialogTitle>
          <DialogDescription>
            Saves every schedule item with its duration, spacing, phase, crew
            placeholder, visibility, notes and predecessors. Dates become
            workdays from the first item, so the template can start on any
            date. Progress and confirmations stay with this project.
          </DialogDescription>
        </DialogHeader>

        {savedTemplateId ? (
          <div className="space-y-3 border-y py-4 text-sm">
            <p>
              The template is ready. Import it into another project from
              <span className="font-medium"> Import schedule items</span>.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/templates/${savedTemplateId}`}>
                Open in Template Library
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <p className="text-sm text-muted-foreground">
              {itemCount} schedule item{itemCount === 1 ? "" : "s"} ·{" "}
              {dependencyCount} predecessor{dependencyCount === 1 ? "" : "s"}
            </p>

            {savedTemplates.length > 0 && (
              <RadioGroup
                value={mode}
                onValueChange={(value) => setMode(value === "update" ? "update" : "new")}
                className="gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="new" id="save-template-new" />
                  <Label htmlFor="save-template-new" className="font-normal">
                    Create a new template
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="update" id="save-template-update" />
                  <Label htmlFor="save-template-update" className="font-normal">
                    Save as a new version of a saved schedule
                  </Label>
                </div>
              </RadioGroup>
            )}

            {mode === "update" ? (
              <div className="space-y-2">
                <Label htmlFor="save-template-existing">Saved schedule</Label>
                <SearchableCombobox
                  id="save-template-existing"
                  ariaLabel="Choose saved schedule template"
                  options={savedTemplates.map((template) => ({
                    value: template.id,
                    label: template.name,
                    description:
                      template.currentVersionNumber === null
                        ? undefined
                        : `Version ${template.currentVersionNumber}`,
                  }))}
                  value={replaceTemplateId}
                  onValueChange={setReplaceTemplateId}
                  placeholder="Choose a saved schedule"
                  searchPlaceholder="Search saved schedules..."
                  emptyMessage="No matching saved schedules."
                />
                <p className="text-xs text-muted-foreground">
                  Projects that already used an earlier version keep it.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="save-template-name">Template name</Label>
                <Input
                  id="save-template-name"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.currentTarget.value)}
                  placeholder="e.g. ICF basement, full build"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="save-template-category">Category (optional)</Label>
              <Input
                id="save-template-category"
                value={category}
                maxLength={80}
                onChange={(event) => setCategory(event.currentTarget.value)}
                placeholder={mode === "new" ? "Schedules" : "Keep current category"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="save-template-description">Description (optional)</Label>
              <Textarea
                id="save-template-description"
                value={description}
                maxLength={1000}
                rows={3}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="When to use this schedule"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {savedTemplateId ? "Done" : "Cancel"}
          </Button>
          {!savedTemplateId && (
            <Button onClick={handleSave} disabled={!canSave}>
              {isSaving && <IconLoader2 className="mr-2 size-4 animate-spin" />}
              Save template
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
