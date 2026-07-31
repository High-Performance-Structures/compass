"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconLoader2, IconTemplate } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  applyScheduleTemplate,
  getProjectTemplateLibrary,
  type ProjectTemplateLibraryItem,
} from "@/app/actions/project-templates"
import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ScheduleTemplateDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly projectId: string
}

function localDateValue(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function ScheduleTemplateDialog({
  open,
  onOpenChange,
  projectId,
}: ScheduleTemplateDialogProps) {
  const router = useRouter()
  const [templates, setTemplates] = useState<
    readonly ProjectTemplateLibraryItem[]
  >([])
  const [templateId, setTemplateId] = useState("")
  const [anchorDate, setAnchorDate] = useState(localDateValue)
  const [loading, setLoading] = useState(false)
  const [isApplying, startApplying] = useTransition()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    getProjectTemplateLibrary()
      .then((items) => {
        if (!cancelled) setTemplates(items)
      })
      .catch((error: unknown) => {
        console.error("Unable to load templates", error)
        if (!cancelled) toast.error("Unable to load the Template Library.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const readyTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.lifecycleStatus === "active" &&
          template.reviewStatus === "verified" &&
          template.currentVersionStatus === "published" &&
          template.scheduleItemCount > 0
      ),
    [templates]
  )
  const selected = readyTemplates.find(
    (template) => template.id === templateId
  )

  const handleApply = (): void => {
    if (!templateId || !anchorDate) return
    startApplying(async () => {
      const result = await applyScheduleTemplate({
        projectId,
        templateId,
        anchorDate,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        `Added ${result.itemCount} schedule items and ${result.dependencyCount} dependencies.`
      )
      setTemplateId("")
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add schedule from template</DialogTitle>
          <DialogDescription>
            Choose a verified template and the date its first item should begin.
            The new project items remain independently editable.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
            <IconLoader2 className="mr-2 size-4 animate-spin" />
            Loading templates…
          </div>
        ) : readyTemplates.length === 0 ? (
          <div className="border-y py-6">
            <div className="flex items-start gap-3">
              <IconTemplate className="mt-0.5 size-5 text-muted-foreground" />
              <div className="space-y-2">
                <p className="font-medium">No verified templates are ready yet.</p>
                <p className="text-sm text-muted-foreground">
                  Imported inventory remains unavailable until its schedule
                  items and dependencies have been captured and reviewed.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard/templates">Open Template Library</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-template">Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger id="schedule-template">
                  <SelectValue placeholder="Choose a verified template…" />
                </SelectTrigger>
                <SelectContent>
                  {readyTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-anchor-date">New start date</Label>
              <Input
                id="template-anchor-date"
                type="date"
                value={anchorDate}
                onChange={(event) => setAnchorDate(event.currentTarget.value)}
              />
            </div>
            {selected && (
              <div className="border-y py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{selected.name}</span>
                  {selected.tradeCategory && (
                    <Badge variant="outline">{selected.tradeCategory}</Badge>
                  )}
                </div>
                <p className="mt-2 text-muted-foreground">
                  {selected.scheduleItemCount} schedule items ·{" "}
                  {selected.dependencyCount} dependencies · version{" "}
                  {selected.currentVersionNumber}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Trade assignments are preserved as placeholders for project
                  contact review after application.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={!selected || !anchorDate || isApplying}
          >
            {isApplying && <IconLoader2 className="mr-2 size-4 animate-spin" />}
            Add to schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
