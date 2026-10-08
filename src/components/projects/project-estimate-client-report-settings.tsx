"use client"

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod/v4"
import { useRouter } from "next/navigation"
import { IconExternalLink, IconFileDescription } from "@tabler/icons-react"

import {
  saveEstimateTextTemplate,
  saveProjectEstimatePhaseDescription,
  setProjectEstimateClientReportMode,
  setProjectEstimateAcknowledgements,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import {
  isEstimateClientReportMode,
  type EstimateClientReportMode,
} from "@/lib/estimates/client-report"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { ESTIMATE_CLIENT_REPORT_MODES } from "@/lib/estimates/client-report"
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
import type { EstimateWorkSection } from "@/lib/estimates/workspace-sections"
import { ProjectEstimateAssemblyEditor } from "@/components/projects/project-estimate-assembly-editor"
import { ProjectEstimateReportPhaseEditor } from "@/components/projects/project-estimate-report-phase-editor"

const reportSettingsSchema = z.object({
  reportMode: z.enum(ESTIMATE_CLIENT_REPORT_MODES),
  showAssemblyBuilderFee: z.boolean(),
  showCostBreakdowns: z.boolean(),
})

function reportModeLabel(mode: EstimateClientReportMode): string {
  if (mode === "division_summary") return "Division subtotals + grand total"
  if (mode === "phase_summary") return "Phase subtotals + grand total"
  if (mode === "assembly_summary") return "Assembly totals"
  if (mode === "assembly_items") return "Assembly cost code detail"
  return "Line items + division totals"
}

export function ProjectEstimateClientReportSettings({
  projectId,
  workspace,
  estimate,
  editable,
  workSection,
}: {
  readonly projectId: string
  readonly workspace: ProjectEstimateWorkspace
  readonly estimate: ProjectEstimateSummary
  readonly editable: boolean
  readonly workSection?: EstimateWorkSection
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const reportForm = useForm<z.infer<typeof reportSettingsSchema>>({
    resolver: zodResolver(reportSettingsSchema),
    defaultValues: {
      reportMode: workspace.reportMode,
      showAssemblyBuilderFee: estimate.showAssemblyBuilderFee,
      showCostBreakdowns: estimate.showCostBreakdowns,
    },
  })
  const reportMode = reportForm.watch("reportMode")
  const showAssemblyBuilderFee = reportForm.watch("showAssemblyBuilderFee")
  const showCostBreakdowns = reportForm.watch("showCostBreakdowns")
  const assemblyReport =
    reportMode === "assembly_summary" || reportMode === "assembly_items"
  const [acknowledgementIds, setAcknowledgementIds] = useState<readonly string[]>(
    workspace.selectedAcknowledgements.map((item) => item.templateId)
  )
  useEffect(() => {
    reportForm.reset({
      reportMode: workspace.reportMode,
      showAssemblyBuilderFee: estimate.showAssemblyBuilderFee,
      showCostBreakdowns: estimate.showCostBreakdowns,
    })
  }, [
    workspace.reportMode,
    estimate.id,
    estimate.showAssemblyBuilderFee,
    estimate.showCostBreakdowns,
    reportForm,
  ])
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

  function saveReportMode(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await setProjectEstimateClientReportMode(
        projectId,
        estimate.id,
        reportMode,
        showAssemblyBuilderFee,
        showCostBreakdowns
      )
      setMessage(result.success ? "Client report view saved." : result.error)
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
    <section
      className="clarity-panel-strong p-4"
      hidden={
        workSection !== undefined &&
        !["report", "descriptions", "contract", "text"].includes(workSection)
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconFileDescription className="mt-0.5 size-5 text-primary" />
          <div>
            <h2 className="font-semibold">
              {workSection === "descriptions"
                ? "Group descriptions & report phases"
                : workSection === "contract"
                  ? "Customer acknowledgements"
                  : workSection === "text"
                    ? "Department text templates"
                    : "Client report presentation"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {workSection === "descriptions"
                ? "Edit the scope shown beneath assembly and division totals, or organize custom report phases."
                : workSection === "contract"
                  ? "Choose the additional forms to append to the client report."
                  : workSection === "text"
                    ? "Reuse department introductions, closing text, and contract terms across estimates."
                    : "Choose detail or totals by division or assembly. Internal markup rates stay in the working estimate."}
            </p>
          </div>
        </div>
        <div hidden={workSection !== undefined && workSection !== "report"}>
          <Badge variant="outline">
            {reportModeLabel(workspace.reportMode)}
          </Badge>
        </div>
      </div>

      {message && (
        <p className="mt-3 rounded-md border bg-muted/35 px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <div hidden={workSection !== undefined && workSection !== "report"}>
        <form onSubmit={reportForm.handleSubmit(saveReportMode)} className="mt-5 grid gap-3 border-t pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="client-report-view">Client report view</Label>
            <SearchableCombobox
              id="client-report-view"
              ariaLabel="Client report presentation"
              placeholder="Choose report view"
              value={reportMode}
              options={ESTIMATE_CLIENT_REPORT_MODES.map((mode) => ({
                value: mode,
                label: reportModeLabel(mode),
              }))}
              onValueChange={(value) => { if (isEstimateClientReportMode(value)) reportForm.setValue("reportMode", value) }}
              disabled={!editable}
            />
          </div>
          {editable && (
            <Button
              type="submit"
              variant="outline"
              disabled={
                isPending ||
                (reportMode === workspace.reportMode &&
                  showAssemblyBuilderFee === estimate.showAssemblyBuilderFee &&
                  showCostBreakdowns === estimate.showCostBreakdowns)
              }
            >
              Save report view
            </Button>
          )}
          <div className="md:col-span-2">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={showCostBreakdowns}
                onCheckedChange={(checked) =>
                  reportForm.setValue("showCostBreakdowns", checked === true)
                }
                disabled={!editable || isPending}
              />
              <span>
                <span className="font-medium">
                  Show cost breakdowns in customer report
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Off by default. Include underlying labor, material, and other
                  costs beneath itemized cost codes. Totals-only and lump-sum
                  groups stay summarized.
                </span>
              </span>
            </label>
          </div>
          {assemblyReport && (
            <div className="md:col-span-2">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox className="mt-0.5" checked={showAssemblyBuilderFee} onCheckedChange={(checked) => reportForm.setValue("showAssemblyBuilderFee", checked === true)} disabled={!editable || isPending} />
            <span>
              <span className="font-medium">Show builder-fee subtotal for each assembly</span>
              <span className="mt-1 block text-xs text-muted-foreground">Show combined overhead, margin, and contingency plus each assembly’s total including its fee. Items excluded from builder fees remain excluded.</span>
            </span>
          </label>
        </div>
          )}
        </form>
      </div>
      <div hidden={workSection !== undefined && workSection !== "descriptions"}>
        {workspace.assemblies.length > 0 && (
          <div className="mt-4 space-y-3">
            <h3 className="text-sm font-semibold">Assembly descriptions</h3>
            {workspace.assemblies.map((assembly) => (
              <div
                key={assembly.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b pb-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{assembly.name}</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {assembly.description ||
                      "No report description saved. The totals report will summarize its customer-visible cost code scopes."}
                  </p>
                </div>
                {editable && (
                  <ProjectEstimateAssemblyEditor
                    projectId={projectId}
                    estimateId={estimate.id}
                    assembly={assembly}
                    assemblies={workspace.assemblies}
                    lines={workspace.lines}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        <ProjectEstimateReportPhaseEditor projectId={projectId} estimateId={estimate.id} workspace={workspace} editable={editable} key={estimate.id} />

        {phases.length > 0 && (
          <div className="mt-5 space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">
                Default CSI group descriptions
              </h3>
              <p className="text-xs text-muted-foreground">
                These descriptions explain division totals and apply to lines
                not assigned to a custom phase. Custom phases use their own name
                and scope description above.
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
      </div>
      <div hidden={workSection !== undefined && workSection !== "contract"}>
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
      </div>
      <details
        hidden={
          workSection !== undefined &&
          workSection !== "text" &&
          workSection !== "contract"
        }
        className="mt-5 border-t pt-4"
      >
        <summary className="text-sm font-medium">
          Manage department text templates
        </summary>
        {editable && (
        <form className="mt-5 border-t pt-4" onSubmit={saveTextTemplate}>
          <h3 className="text-sm font-semibold">
            Add an {workspace.department}-department text template
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Department templates become available in future estimates without
            changing any estimate that has already been issued. Compass also
            saves the template in Google Drive under Compass / Template Library.
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
            <div className="flex items-end md:col-span-2 xl:col-span-4">
              <Button type="submit" disabled={isPending}>
                Save department template
              </Button>
            </div>
          </div>
        </form>
      )}
      </details>
    </section>
  )
}
