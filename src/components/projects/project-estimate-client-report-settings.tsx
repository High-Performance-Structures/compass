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

import { setEstimateAssemblyClientDetail } from "@/app/actions/estimate-assemblies"
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
import { formatCurrency } from "@/lib/utils"
import {
  changedReportSettings,
  reportSettingsSaveMessage,
  type ReportSettingsSaveResult,
  type ReportSettingsState,
} from "@/lib/estimates/report-settings-save"
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
  const savedDetailIds = useMemo(
    () => workspace.assemblies.filter((assembly) => assembly.clientDetail).map((assembly) => assembly.id),
    [workspace.assemblies]
  )
  const [detailIds, setDetailIds] = useState<readonly string[]>(savedDetailIds)
  useEffect(() => setDetailIds(savedDetailIds), [savedDetailIds])
  const assemblyTotals = useMemo(() => {
    const totals = new Map<string, { count: number; cents: number }>()
    for (const line of workspace.lines) {
      if (!line.assemblyId || !line.ownerVisible) continue
      const current = totals.get(line.assemblyId) ?? { count: 0, cents: 0 }
      totals.set(line.assemblyId, { count: current.count + 1, cents: current.cents + line.lineTotalCents })
    }
    return totals
  }, [workspace.lines])
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
  const [phaseDrafts, setPhaseDrafts] = useState<ReadonlyMap<string, string>>(phaseDescriptions)
  useEffect(() => setPhaseDrafts(phaseDescriptions), [phaseDescriptions])
  const savedAcknowledgementIds = useMemo(
    () => workspace.selectedAcknowledgements.map((item) => item.templateId),
    [workspace.selectedAcknowledgements]
  )
  useEffect(() => setAcknowledgementIds(savedAcknowledgementIds), [savedAcknowledgementIds])
  const includeAcknowledgements = workspace.department === "N"
  const savedSettings: ReportSettingsState = {
    view: {
      reportMode: workspace.reportMode,
      showAssemblyBuilderFee: estimate.showAssemblyBuilderFee,
      showCostBreakdowns: estimate.showCostBreakdowns,
    },
    assemblyDetailIds: savedDetailIds,
    phaseDescriptions,
    acknowledgementIds: savedAcknowledgementIds,
  }
  const draftSettings: ReportSettingsState = {
    view: { reportMode, showAssemblyBuilderFee, showCostBreakdowns },
    assemblyDetailIds: detailIds,
    phaseDescriptions: phaseDrafts,
    acknowledgementIds,
  }
  const changes = changedReportSettings(savedSettings, draftSettings, phases, includeAcknowledgements)
  const hasUnsavedChanges = changes.length > 0

  function setPhaseDraft(divisionCode: string, description: string): void {
    setPhaseDrafts((current) => new Map(current).set(divisionCode, description))
  }

  // Saves every changed section and reports exactly which ones failed.
  function saveReportSettings(): void {
    if (changes.length === 0) return
    setMessage(null)
    startTransition(async () => {
      const results: ReportSettingsSaveResult[] = []
      for (const section of changes) {
        const result =
          section.kind === "view"
            ? await setProjectEstimateClientReportMode(
                projectId,
                estimate.id,
                reportMode,
                showAssemblyBuilderFee,
                showCostBreakdowns
              )
            : section.kind === "assemblyDetail"
              ? await setEstimateAssemblyClientDetail(projectId, estimate.id, detailIds)
              : section.kind === "phase"
                ? await saveProjectEstimatePhaseDescription(projectId, estimate.id, {
                    divisionCode: section.divisionCode,
                    description: (phaseDrafts.get(section.divisionCode) ?? "").trim(),
                  })
                : await setProjectEstimateAcknowledgements(projectId, estimate.id, acknowledgementIds)
        results.push({ section, error: result.success ? null : result.error })
      }
      setMessage(reportSettingsSaveMessage(results))
      if (results.some((result) => result.error === null)) router.refresh()
    })
  }

  function toggleAcknowledgement(templateId: string, selected: boolean): void {
    setAcknowledgementIds((current) =>
      selected
        ? [...current.filter((id) => id !== templateId), templateId]
        : current.filter((id) => id !== templateId)
    )
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
        <div className="mt-5 grid gap-3 border-t pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
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
          {reportMode === "assembly_summary" && workspace.assemblies.length > 0 && (
            <fieldset className="md:col-span-2 border-t pt-4">
              <legend className="text-sm font-medium">Show cost codes for these assemblies</legend>
              <p className="mt-1 text-xs text-muted-foreground">
                Every other assembly prints as one total. Ticked assemblies list their cost codes and cost breakdowns with quantities and amounts.
              </p>
              <ul className="mt-2 divide-y border-y">
                {workspace.assemblies.map((assembly) => {
                  const totals = assemblyTotals.get(assembly.id) ?? { count: 0, cents: 0 }
                  const checked = detailIds.includes(assembly.id)
                  return (
                    <li key={assembly.id}>
                      <label className="flex min-h-11 items-center gap-3 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            setDetailIds((current) =>
                              value === true
                                ? [...current.filter((id) => id !== assembly.id), assembly.id]
                                : current.filter((id) => id !== assembly.id)
                            )
                          }
                          disabled={!editable || isPending}
                        />
                        <span className={checked ? "flex-1 font-medium" : "flex-1"}>{assembly.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {totals.count} {totals.count === 1 ? "line" : "lines"}
                        </span>
                        <span className="w-28 text-right tabular-nums">{formatCurrency(totals.cents / 100)}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )}
        </div>
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
            <div
              key={divisionCode}
              className="grid gap-2 md:grid-cols-[9rem_minmax(0,1fr)] md:items-end"
            >
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
                  value={phaseDrafts.get(divisionCode) ?? ""}
                  onChange={(event) => setPhaseDraft(divisionCode, event.target.value)}
                  placeholder={divisionName}
                  disabled={!editable || isPending}
                />
              </div>
            </div>
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
        </div>
      )}
      </div>
      {editable && (
        <div
          hidden={workSection === "text"}
          className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t pt-4"
        >
          <p className="text-sm text-muted-foreground" role="status">
            {hasUnsavedChanges ? "Unsaved changes" : "All report settings saved"}
          </p>
          <Button
            type="button"
            disabled={isPending || !hasUnsavedChanges}
            onClick={saveReportSettings}
          >
            {isPending ? "Saving..." : "Save report settings"}
          </Button>
        </div>
      )}
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
