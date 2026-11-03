"use client"

import { toast } from "sonner"
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconEye } from "@tabler/icons-react"

import type { EstimateTemplateOption } from "@/app/actions/estimate-templates"
import type { ProjectFamilySummary } from "@/lib/domain/families/rules"
import type { ProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { EstimatePricingBoard } from "@/components/projects/estimate-pricing-board"
import { useEstimatePricingView } from "@/components/projects/estimate-line-priced-by"
import {
  ESTIMATE_WORK_SECTIONS,
  isEstimateWorkSection,
  type EstimateWorkSection,
} from "@/lib/estimates/workspace-sections"
import { ProjectEstimatePhaseProposals } from "@/components/projects/project-estimate-phase-proposals"
import type { ProjectPhaseProposalSummary } from "@/app/actions/estimate-phase-proposals"
import type { EstimateAssemblyCopySummary } from "@/app/actions/estimate-project-copies"
import { Badge } from "@/components/ui/badge"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { ProjectEstimateClientReportSettings } from "@/components/projects/project-estimate-client-report-settings"
import { ProjectEstimateVersionControls } from "@/components/projects/project-estimate-version-controls"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { formatCents } from "@/lib/format"

import { EstimateApprovalSection } from "./estimate-workspace/estimate-approval-section"
import { EstimateBasisSection } from "./estimate-workspace/estimate-basis-section"
import { EstimateCostsSection } from "./estimate-workspace/estimate-costs-section"
import { EstimateHeaderForm } from "./estimate-workspace/estimate-header-form"
import { EstimateStartPanel } from "./estimate-workspace/estimate-start-panel"
import {
  statusLabel,
  taxEntityComboboxOptions,
  type EstimateBuildView,
} from "./estimate-workspace/estimate-workspace-helpers"
import { useEstimateHeaderState } from "./estimate-workspace/use-estimate-header-state"
import {
  useEstimateLineEditor,
  type EstimateWorkspaceRunner,
} from "./estimate-workspace/use-estimate-line-editor"

export function ProjectEstimateWorkspacePanel({
  projectId,
  workspace,
  estimateTemplates,
  family,
  phaseProposals = [],
  assemblyCopies = [],
}: {
  readonly projectId: string
  readonly workspace: ProjectEstimateWorkspace
  readonly estimateTemplates: readonly EstimateTemplateOption[]
  readonly family: ProjectFamilySummary | null
  readonly phaseProposals?: readonly ProjectPhaseProposalSummary[]
  readonly assemblyCopies?: readonly EstimateAssemblyCopySummary[]
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const router = useRouter()
  const estimate = workspace.activeEstimate
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  // Also show each message where the person is working: the banner sits at the
  // top of a long page, so errors from lower panels looked like nothing happened.
  useEffect(() => {
    if (message) toast(message)
  }, [message])
  const [signatureMessage, setSignatureMessage] = useState<string | null>(null)
  const [acceptanceChangesContract, setAcceptanceChangesContract] = useState(false)
  const [manualAcceptanceAttested, setManualAcceptanceAttested] =
    useState(false)
  const [workSection, setWorkSection] = useState<EstimateWorkSection>("costs")
  const [buildView, setBuildView] = useState<EstimateBuildView>("division")
  const editor = useEstimateLineEditor()
  const pricing = useEstimatePricingView(projectId, estimate?.id ?? null)
  const header = useEstimateHeaderState(estimate)
  const editable =
    workspace.canEdit &&
    Boolean(estimate && ["draft", "internal_review"].includes(estimate.status))

  useEffect(() => {
    setSignatureMessage(null)
  }, [estimate?.id])

  const taxEntityOptions = useMemo(
    () => taxEntityComboboxOptions(workspace.taxEntities),
    [workspace.taxEntities]
  )

  function finish(messageText: string): void {
    setMessage(messageText)
    router.refresh()
  }

  const runner: EstimateWorkspaceRunner = {
    projectId,
    isPending,
    startTransition,
    setMessage,
    finish,
  }

  if (!estimate) {
    return (
      <EstimateStartPanel
        runner={runner}
        canEdit={workspace.canEdit}
        estimateTemplates={estimateTemplates}
        taxEntityOptions={taxEntityOptions}
      />
    )
  }

  return (
    <div className="space-y-5">
      {message && (
        <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm">
          {message}
        </div>
      )}

      {workspace.changeOrder && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-l-4 border-l-primary bg-muted/30 px-4 py-3 text-sm">
          <p>
            <span className="font-medium">Change-order estimate</span> for {workspace.changeOrder.number}: {workspace.changeOrder.title}.
            {" "}Accepting it executes the change order and adds it to the budget; the contract estimate is unchanged.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/projects/${encodeURIComponent(projectId)}/change-orders/${encodeURIComponent(workspace.changeOrder.id)}`}>
              Back to {workspace.changeOrder.number}
            </Link>
          </Button>
        </div>
      )}

      <ProjectEstimatePhaseProposals
        projectId={projectId}
        proposals={phaseProposals}
        activeEstimate={estimate}
        canEdit={workspace.canEdit}
        canDelete={workspace.canDelete}
      />

      <section className="clarity-panel-strong overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{estimate.title}</h2>
              <Badge variant="outline">v{estimate.versionNumber}</Badge>
              <Badge>{statusLabel(estimate.status)}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {estimate.estimateNumber}
              {developerModeEnabled
                ? ` · Foxit ${statusLabel(estimate.foxitStatus)} · Sage ${statusLabel(estimate.sageStatus)}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <div>
              <ProjectEstimateVersionControls
              projectId={projectId}
              estimates={workspace.estimates}
              activeEstimate={estimate}
              canEdit={workspace.canEdit}
              canDelete={workspace.canDelete}
              family={family}
              estimateMode={workspace.estimateMode}
            />
            </div>
            <Button variant="outline" asChild>
              <Link
                href={`/print/projects/${projectId}/estimate?estimateId=${estimate.id}`}
                target="_blank"
              >
                <IconEye className="size-4" />
                Print Preview
              </Link>
            </Button>
          </div>
        </div>
        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {[
            ["Direct cost", estimate.directCostCents],
            ["Line markup", estimate.markupCents],
            ["Sales tax", estimate.taxCents],
            ["Estimate total", estimate.estimateTotalCents],
          ].map(([label, value]) => (
            <div key={String(label)} className="px-4 py-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold">{formatCents(Number(value))}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-y bg-estimate-subtotal px-4 py-3">
        <Label htmlFor="estimate-work-section">Work on</Label>
        <SearchableCombobox
          id="estimate-work-section"
          ariaLabel="Work on"
          placeholder="Choose an area"
          searchPlaceholder="Search estimate areas..."
          className="w-full sm:w-80"
          value={workSection}
          options={ESTIMATE_WORK_SECTIONS}
          onValueChange={(value) => {
            if (isEstimateWorkSection(value)) setWorkSection(value)
          }}
        />
        <p className="text-xs text-muted-foreground">
          {
            ESTIMATE_WORK_SECTIONS.find(
              (section) => section.value === workSection
            )?.description
          }
        </p>
      </div>

      <EstimateHeaderForm
        runner={runner}
        estimate={estimate}
        workspace={workspace}
        header={header}
        editable={editable}
        workSection={workSection}
        setWorkSection={setWorkSection}
        setLine={editor.setLine}
        taxEntityOptions={taxEntityOptions}
      />

      <ProjectEstimateClientReportSettings
        projectId={projectId}
        workspace={workspace}
        estimate={estimate}
        editable={editable}
        workSection={workSection}
      />

      <EstimateCostsSection
        runner={runner}
        estimate={estimate}
        workspace={workspace}
        workSection={workSection}
        buildView={buildView}
        setBuildView={setBuildView}
        editable={editable}
        editor={editor}
        pricing={pricing}
        taxEntityOptions={taxEntityOptions}
        defaultTaxEntityId={header.defaultTaxEntityId}
        assemblyCopies={assemblyCopies}
      />

      <section
        className="clarity-panel-strong p-4"
        hidden={workSection !== "pricing"}
      >
        <EstimatePricingBoard projectId={projectId} estimateId={estimate.id} editable={editable} active={workSection === "pricing"} />
      </section>

      <EstimateBasisSection
        runner={runner}
        estimate={estimate}
        workspace={workspace}
        editable={editable}
        hidden={workSection !== "basis"}
      />

      <EstimateApprovalSection
        runner={runner}
        estimate={estimate}
        workspace={workspace}
        editable={editable}
        hidden={workSection !== "approval"}
        approval={{
          signatureMessage,
          setSignatureMessage,
          acceptanceChangesContract,
          setAcceptanceChangesContract,
          manualAcceptanceAttested,
          setManualAcceptanceAttested,
        }}
      />
    </div>
  )
}
