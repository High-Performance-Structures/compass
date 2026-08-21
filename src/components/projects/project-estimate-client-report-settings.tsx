"use client"

import { useMemo, useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconExternalLink, IconFileDescription } from "@tabler/icons-react"

import {
  saveEstimateTextTemplate,
  saveProjectEstimatePhaseDescription,
  setProjectEstimateAcknowledgements,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

function reportModeLabel(workspace: ProjectEstimateWorkspace): string {
  if (workspace.reportMode === "phase_summary") {
    return "Phase subtotals only"
  }
  if (workspace.reportMode === "cost_code") {
    return "Individual cost codes"
  }
  return "CA22 phase and cost-code detail"
}

export function ProjectEstimateClientReportSettings({
  projectId,
  workspace,
  estimate,
  editable,
}: {
  readonly projectId: string
  readonly workspace: ProjectEstimateWorkspace
  readonly estimate: ProjectEstimateSummary
  readonly editable: boolean
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [acknowledgementIds, setAcknowledgementIds] = useState<readonly string[]>(
    workspace.selectedAcknowledgements.map((item) => item.templateId)
  )
  const phases = useMemo(() => {
    const groups = new Map<string, string>()
    for (const line of workspace.lines) {
      if (!groups.has(line.divisionCode)) {
        groups.set(line.divisionCode, line.divisionName)
      }
    }
    return [...groups.entries()].sort((left, right) =>
      left[0].localeCompare(right[0])
    )
  }, [workspace.lines])
  const phaseDescriptions = useMemo(
    () =>
      new Map(
        workspace.phaseDescriptions.map((item) => [
          item.divisionCode,
          item.description,
        ])
      ),
    [workspace.phaseDescriptions]
  )

  function savePhase(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const divisionCode = String(formData.get("divisionCode") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    setMessage(null)
    startTransition(async () => {
      const result = await saveProjectEstimatePhaseDescription(
        projectId,
        estimate.id,
        { divisionCode, description }
      )
      setMessage(
        result.success ? "Phase description saved." : result.error
      )
      if (result.success) router.refresh()
    })
  }

  function toggleAcknowledgement(templateId: string, selected: boolean): void {
    setAcknowledgementIds((current) =>
      selected
        ? [...current.filter((id) => id !== templateId), templateId]
        : current.filter((id) => id !== templateId)
    )
  }

  function saveAcknowledgements(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await setProjectEstimateAcknowledgements(
        projectId,
        estimate.id,
        acknowledgementIds
      )
      setMessage(
        result.success ? "Acknowledgement selections saved." : result.error
      )
      if (result.success) router.refresh()
    })
  }

  function saveTextTemplate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const value = (name: string): string =>
      String(formData.get(name) ?? "").trim()
    setMessage(null)
    startTransition(async () => {
      const result = await saveEstimateTextTemplate(projectId, {
        name: value("templateName"),
        templateType: value("templateType"),
        body: value("templateBody"),
        sourceUrl: value("templateSourceUrl"),
      })
      setMessage(
        result.success
          ? `${workspace.department}-department text template saved.`
          : result.error
      )
      if (result.success) {
        form.reset()
        router.refresh()
      }
    })
  }

  return (
    <section className="clarity-panel-strong p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconFileDescription className="mt-0.5 size-5 text-primary" />
          <div>
            <h2 className="font-semibold">Client report presentation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The client view follows the {workspace.department}-department
              estimate format. Internal quantities, markup, and tax details stay
              in the working estimate.
            </p>
          </div>
        </div>
        <Badge variant="outline">{reportModeLabel(workspace)}</Badge>
      </div>

      {message && (
        <p className="mt-3 rounded-md border bg-muted/35 px-3 py-2 text-sm">
          {message}
        </p>
      )}

      {workspace.reportMode !== "cost_code" && phases.length > 0 && (
        <div className="mt-5 space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-semibold">Phase descriptions</h3>
            <p className="text-xs text-muted-foreground">
              These client-facing descriptions replace the default CSI division
              names. Phase subtotals continue to come from the estimate lines.
            </p>
          </div>
          {phases.map(([divisionCode, divisionName]) => (
            <form
              key={divisionCode}
              className="grid gap-2 md:grid-cols-[9rem_minmax(0,1fr)_auto] md:items-end"
              onSubmit={savePhase}
            >
              <input type="hidden" name="divisionCode" value={divisionCode} />
              <div className="space-y-1.5">
                <Label>Phase</Label>
                <div className="flex h-9 items-center text-sm font-medium">
                  {divisionCode} - {divisionName}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`phase-description-${divisionCode}`}>
                  Client description
                </Label>
                <Input
                  id={`phase-description-${divisionCode}`}
                  name="description"
                  defaultValue={phaseDescriptions.get(divisionCode) ?? ""}
                  placeholder={divisionName}
                  disabled={!editable}
                />
              </div>
              {editable && (
                <Button type="submit" variant="outline" disabled={isPending}>
                  Save phase
                </Button>
              )}
            </form>
          ))}
        </div>
      )}

      {workspace.department === "N" && (
        <div className="mt-5 border-t pt-4">
          <h3 className="text-sm font-semibold">Append acknowledgements</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Selected forms are snapshotted with this estimate and appended to
            the printable report.
          </p>
          <div className="mt-3 space-y-3">
            {workspace.acknowledgementTemplates.map((template) => (
              <div
                key={template.value}
                className="flex items-start justify-between gap-4 rounded-md border p-3"
              >
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={acknowledgementIds.includes(template.value)}
                    onCheckedChange={(checked) =>
                      toggleAcknowledgement(template.value, checked === true)
                    }
                    disabled={!editable}
                  />
                  <span>
                    <span className="font-medium">{template.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Appended as a separate signature-ready report section.
                    </span>
                  </span>
                </label>
                {template.sourceUrl && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={template.sourceUrl} target="_blank">
                      Source <IconExternalLink className="size-3.5" />
                    </Link>
                  </Button>
                )}
              </div>
            ))}
          </div>
          {editable && (
            <Button
              type="button"
              className="mt-3"
              variant="outline"
              disabled={isPending}
              onClick={saveAcknowledgements}
            >
              Save acknowledgements
            </Button>
          )}
        </div>
      )}

      {editable && (
        <form className="mt-5 border-t pt-4" onSubmit={saveTextTemplate}>
          <h3 className="text-sm font-semibold">
            Add an {workspace.department}-department text template
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Department templates become available in future estimates without
            changing any estimate that has already been issued.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="estimate-template-type">Template type</Label>
              <Select name="templateType" defaultValue="terms">
                <SelectTrigger id="estimate-template-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="terms">Terms and conditions</SelectItem>
                  <SelectItem value="introduction">Introduction</SelectItem>
                  <SelectItem value="closing">Closing text</SelectItem>
                  <SelectItem value="acknowledgement">Acknowledgement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-1 xl:col-span-3">
              <Label htmlFor="estimate-template-name">Template name</Label>
              <Input id="estimate-template-name" name="templateName" required />
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
              <Label htmlFor="estimate-template-body">Template text</Label>
              <Textarea
                id="estimate-template-body"
                name="templateBody"
                rows={6}
                required
              />
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
              <Label htmlFor="estimate-template-source">Source link</Label>
              <Input
                id="estimate-template-source"
                name="templateSourceUrl"
                type="url"
                placeholder="Optional Google Drive source"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending}>
                Save department template
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}
