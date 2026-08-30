"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconFileDescription,
  IconFileExport,
  IconPlus,
  IconReceiptTax,
  IconRefresh,
  IconSend,
  IconTemplate,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react"

import {
  createProjectEstimateFromTemplate,
  type EstimateTemplateOption,
} from "@/app/actions/estimate-templates"

import {
  addProjectEstimateBasisDocument,
  applyProjectEstimateLineMarkup,
  createProjectEstimateDraft,
  deleteProjectEstimateBasisDocument,
  deleteProjectEstimateLine,
  importProjectEstimateFromGoogleSheet,
  markProjectEstimateSentOutsideCompass,
  prepareProjectEstimateForClientSignature,
  recordManualProjectEstimateAcceptance,
  saveProjectEstimateLine,
  updateProjectEstimateBuilderFee,
  updateProjectEstimateHeader,
  type ProjectEstimateLineItem,
  type ProjectEstimateSigner,
  type ProjectEstimateTermsOption,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import { uploadEstimateAcceptanceEvidence } from "@/components/projects/project-estimate-acceptance-upload"
import { Badge } from "@/components/ui/badge"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { EstimateUnitInput } from "@/components/estimate-unit-input"
import { ProjectEstimateClientReportSettings } from "@/components/projects/project-estimate-client-report-settings"
import { ProjectEstimateLineBreakdown } from "@/components/projects/project-estimate-line-breakdown"
import {
  ProjectEstimateSignerPicker,
  type ProjectEstimateSignerValue,
} from "@/components/projects/project-estimate-signer-picker"
import { ProjectEstimatePlanSwiftImport } from "@/components/projects/project-estimate-planswift-import"
import { ProjectEstimateVersionControls } from "@/components/projects/project-estimate-version-controls"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  estimateAcceptanceMethodLabel,
  isEstimateAcceptanceMethod,
} from "@/lib/estimates/manual-acceptance"
import {
  acceptedEstimateDateLabel,
  acceptedEstimateDocumentUrl,
  acceptedEstimateEvidenceUrl,
} from "@/lib/estimates/accepted-document"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}%`
}

function SignatureRequiredMark(): React.ReactElement {
  return <span className="text-destructive" aria-hidden="true"> *</span>
}

function formText(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim()
  return value.length > 0 ? value : null
}

function formNumber(formData: FormData, name: string): number | null {
  const value = Number(String(formData.get(name) ?? "").replaceAll(",", ""))
  return Number.isFinite(value) ? value : null
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ")
}

function localDateInput(): string {
  const now = new Date()
  const localTime = now.getTime() - now.getTimezoneOffset() * 60_000
  return new Date(localTime).toISOString().slice(0, 10)
}

function selectedTemplateBody(
  options: readonly ProjectEstimateTermsOption[],
  templateId: string
): string {
  return options.find((option) => option.value === templateId)?.body ?? ""
}

type LineDraft = {
  readonly id: string | null
  readonly divisionCode: string
  readonly costCode: string
  readonly description: string
  readonly specifications: string
  readonly quantity: string
  readonly unit: string
  readonly unitCost: string
  readonly markupPercent: string
  readonly taxable: boolean
  readonly taxEntityId: string
  readonly ownerVisible: boolean
  readonly includeInBuilderFee: boolean
}

const EMPTY_LINE: LineDraft = {
  id: null,
  divisionCode: "",
  costCode: "",
  description: "",
  specifications: "",
  quantity: "1",
  unit: "LS",
  unitCost: "",
  markupPercent: "0",
  taxable: false,
  taxEntityId: "",
  ownerVisible: true,
  includeInBuilderFee: true,
}

function lineDraft(line: ProjectEstimateLineItem): LineDraft {
  return {
    id: line.id,
    divisionCode: line.divisionCode,
    costCode: line.costCode,
    description: line.description,
    specifications: line.specifications ?? "",
    quantity: String(line.quantity),
    unit: line.unit,
    unitCost: String(line.unitCostCents / 100),
    markupPercent: String(line.markupRateBasisPoints / 100),
    taxable: line.taxable,
    taxEntityId: line.taxEntityId ?? "",
    ownerVisible: line.ownerVisible,
    includeInBuilderFee: line.includeInBuilderFee,
  }
}

export function ProjectEstimateWorkspacePanel({
  projectId,
  workspace,
  estimateTemplates,
}: {
  readonly projectId: string
  readonly workspace: ProjectEstimateWorkspace
  readonly estimateTemplates: readonly EstimateTemplateOption[]
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const router = useRouter()
  const estimate = workspace.activeEstimate
  const acceptedDocumentUrl = estimate
    ? acceptedEstimateDocumentUrl(estimate)
    : null
  const acceptedEvidenceUrl = estimate
    ? acceptedEstimateEvidenceUrl(estimate)
    : null
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [signatureMessage, setSignatureMessage] = useState<string | null>(null)
  const [manualAcceptanceAttested, setManualAcceptanceAttested] =
    useState(false)
  const [line, setLine] = useState<LineDraft>(EMPTY_LINE)
  const [insertAfterLineId, setInsertAfterLineId] = useState<string | null>(null)
  const lineEditorRef = useRef<HTMLFormElement>(null)
  const [startTemplateId, setStartTemplateId] = useState("")
  const [startTaxEntityId, setStartTaxEntityId] = useState("")
  const [defaultTaxEntityId, setDefaultTaxEntityId] = useState(
    estimate?.defaultTaxEntityId ?? ""
  )
  const [termsTemplateId, setTermsTemplateId] = useState(
    estimate?.termsTemplateId ?? ""
  )
  const [contractTerms, setContractTerms] = useState(
    estimate?.contractTerms ?? ""
  )
  const [introductionTemplateId, setIntroductionTemplateId] = useState(
    estimate?.introductionTemplateId ?? ""
  )
  const [introductionText, setIntroductionText] = useState(
    estimate?.introductionText ?? ""
  )
  const [closingTemplateId, setClosingTemplateId] = useState(
    estimate?.closingTemplateId ?? ""
  )
  const [closingText, setClosingText] = useState(estimate?.closingText ?? "")
  const [clientSigners, setClientSigners] = useState<readonly ProjectEstimateSigner[]>(
    estimate?.clientSigners ?? []
  )
  const [companySigner, setCompanySigner] =
    useState<ProjectEstimateSignerValue>({
      contactId: estimate?.companySignerContactId ?? null,
      name: estimate?.companySignerName ?? "",
      title: estimate?.companySignerTitle ?? "",
      email: estimate?.companySignerEmail ?? "",
    })
  const [companySignerInitials, setCompanySignerInitials] = useState(
    estimate?.companySignerInitials ?? ""
  )
  const editable =
    workspace.canEdit &&
    Boolean(estimate && ["draft", "internal_review"].includes(estimate.status))

  useEffect(() => {
    setDefaultTaxEntityId(estimate?.defaultTaxEntityId ?? "")
    setTermsTemplateId(estimate?.termsTemplateId ?? "")
    setContractTerms(estimate?.contractTerms ?? "")
    setIntroductionTemplateId(estimate?.introductionTemplateId ?? "")
    setIntroductionText(estimate?.introductionText ?? "")
    setClosingTemplateId(estimate?.closingTemplateId ?? "")
    setClosingText(estimate?.closingText ?? "")
    setClientSigners(estimate?.clientSigners ?? [])
    setCompanySigner({
      contactId: estimate?.companySignerContactId ?? null,
      name: estimate?.companySignerName ?? "",
      title: estimate?.companySignerTitle ?? "",
      email: estimate?.companySignerEmail ?? "",
    })
    setCompanySignerInitials(estimate?.companySignerInitials ?? "")
  }, [
    estimate?.id,
    estimate?.defaultTaxEntityId,
    estimate?.termsTemplateId,
    estimate?.contractTerms,
    estimate?.introductionTemplateId,
    estimate?.introductionText,
    estimate?.closingTemplateId,
    estimate?.closingText,
    estimate?.clientSigners,
    estimate?.companySignerContactId,
    estimate?.companySignerName,
    estimate?.companySignerTitle,
    estimate?.companySignerEmail,
    estimate?.companySignerInitials,
  ])

  useEffect(() => {
    setSignatureMessage(null)
  }, [estimate?.id])

  const divisions = useMemo(() => {
    const options = new Map<string, string>()
    for (const option of workspace.costCodes) {
      options.set(option.divisionCode, option.divisionLabel)
    }
    return [...options.entries()].sort((left, right) =>
      left[0].localeCompare(right[0])
    )
  }, [workspace.costCodes])
  const availableCostCodes = workspace.costCodes.filter(
    (option) => option.divisionCode === line.divisionCode
  )
  const lineUsesCostBreakdown = Boolean(
    line.id &&
      workspace.lines.find((item) => item.id === line.id)?.costItems.length
  )
  const mappedCostCodes = useMemo(
    () =>
      new Set(
        workspace.costCodes
          .filter((option) => option.sageMapped)
          .map((option) => option.value)
      ),
    [workspace.costCodes]
  )
  const taxEntityOptions = useMemo(
    () =>
      workspace.taxEntities.map((option) => ({
        value: option.value,
        label: option.label,
        selectedLabel: `${option.label} · ${percent(option.rateBasisPoints)}`,
        description: `${percent(option.rateBasisPoints)} · Sage tax entity`,
        keywords: `${option.code} ${option.rateBasisPoints / 100}`,
      })),
    [workspace.taxEntities]
  )
  const groupedLines = useMemo(() => {
    const groups = new Map<string, ProjectEstimateLineItem[]>()
    for (const item of workspace.lines) {
      const current = groups.get(item.divisionCode) ?? []
      current.push(item)
      groups.set(item.divisionCode, current)
    }
    return [...groups.entries()].sort((left, right) =>
      left[0].localeCompare(right[0])
    )
  }, [workspace.lines])
  const selectedStartTemplate = estimateTemplates.find(
    (template) => template.id === startTemplateId
  )

  function finish(messageText: string): void {
    setMessage(messageText)
    router.refresh()
  }

  function createEstimate(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectEstimateDraft(projectId)
      finish(result.success ? "Estimate draft created." : result.error)
    })
  }

  function createEstimateFromTemplate(): void {
    if (!startTemplateId) return
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectEstimateFromTemplate({
        projectId,
        templateId: startTemplateId,
        defaultTaxEntityId: startTaxEntityId || null,
      })
      finish(
        result.success
          ? "Estimate draft created from the published template."
          : result.error
      )
    })
  }

  function saveHeader(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!estimate) return
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectEstimateHeader(projectId, estimate.id, {
        estimateNumber: formText(formData, "estimateNumber"),
        title: formText(formData, "title"),
        estimateDate: formText(formData, "estimateDate"),
        clientName: formText(formData, "clientName"),
        clientMailingAddress: formText(formData, "clientMailingAddress"),
        clientSignerContactId: clientSigners[0]?.contactId ?? null,
        clientSignerName: clientSigners[0]?.name ?? null,
        clientSignerTitle: clientSigners[0]?.title ?? null,
        clientSignerEmail: clientSigners[0]?.email ?? null,
        clientSigners,
        companySignerContactId: companySigner.contactId,
        companySignerName: companySigner.name,
        companySignerTitle: companySigner.title,
        companySignerEmail: companySigner.email,
        companySignerInitials,
        sourceWorkbookUrl: formText(formData, "sourceWorkbookUrl"),
        defaultTaxEntityId: formText(formData, "defaultTaxEntityId"),
        termsTemplateId: formText(formData, "termsTemplateId"),
        contractTerms: formText(formData, "contractTerms"),
        introductionTemplateId: formText(
          formData,
          "introductionTemplateId"
        ),
        introductionText: formText(formData, "introductionText"),
        closingTemplateId: formText(formData, "closingTemplateId"),
        closingText: formText(formData, "closingText"),
      })
      finish(result.success ? "Estimate details saved." : result.error)
    })
  }

  function saveLine(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!estimate) return
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await saveProjectEstimateLine(
        projectId,
        estimate.id,
        line.id,
        {
          costCode: line.costCode,
          description: formText(formData, "description"),
          specifications: formText(formData, "specifications"),
          quantity: formNumber(formData, "quantity"),
          unit: formText(formData, "unit"),
          unitCost: formNumber(formData, "unitCost"),
          markupPercent: formNumber(formData, "markupPercent"),
          taxable: line.taxable,
          taxEntityId: line.taxEntityId || null,
          ownerVisible: line.ownerVisible,
          includeInBuilderFee: line.includeInBuilderFee,
          insertAfterLineId,
        }
      )
      if (result.success) {
        setLine(EMPTY_LINE)
        setInsertAfterLineId(null)
      }
      finish(result.success ? "Estimate line saved." : result.error)
    })
  }

  function applyLineMarkup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!estimate) return
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await applyProjectEstimateLineMarkup(
        projectId,
        estimate.id,
        formNumber(formData, "bulkMarkupPercent")
      )
      finish(
        result.success
          ? "Line markup applied to every estimate item."
          : result.error
      )
    })
  }

  function saveBuilderFee(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!estimate) return
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectEstimateBuilderFee(
        projectId,
        estimate.id,
        {
          overheadPercent: formNumber(formData, "overheadPercent"),
          marginPercent: formNumber(formData, "marginPercent"),
          contingencyPercent: formNumber(formData, "contingencyPercent"),
        }
      )
      finish(result.success ? "Builder fee updated." : result.error)
    })
  }

  function removeLine(lineId: string): void {
    if (!estimate) return
    setMessage(null)
    startTransition(async () => {
      const result = await deleteProjectEstimateLine(
        projectId,
        estimate.id,
        lineId
      )
      finish(result.success ? "Estimate line removed." : result.error)
    })
  }

  function openLineEditor(
    nextLine: LineDraft,
    insertionPoint: string | null = null
  ): void {
    setLine(nextLine)
    setInsertAfterLineId(insertionPoint)
    window.requestAnimationFrame(() => {
      lineEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      lineEditorRef.current
        ?.querySelector<HTMLInputElement>("#estimateDescription")
        ?.focus({ preventScroll: true })
    })
  }

  function importSourceCsi(): void {
    if (!estimate) return
    if (
      workspace.lines.length > 0 &&
      !window.confirm(
        "Importing Project Totals will replace every line in this editable draft. Continue?"
      )
    ) {
      return
    }
    setMessage(null)
    startTransition(async () => {
      const result = await importProjectEstimateFromGoogleSheet(
        projectId,
        estimate.id
      )
      if (!result.success) {
        finish(result.error)
        return
      }
      const rounding = result.roundingAdjustmentCents === 0
        ? ""
        : ` A ${money(Math.abs(result.roundingAdjustmentCents))} source-rounding adjustment was recorded.`
      const mappings =
        !developerModeEnabled || result.missingSageMappingCount === 0
        ? ""
        : ` ${result.missingSageMappingCount} source cost codes require Sage mapping before signature.`
      finish(
        `${result.lineCount} reconciled CSI lines imported for ${money(result.totalCents)}.${rounding}${mappings}`
      )
    })
  }

  function addBasis(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!estimate) return
    const form = event.currentTarget
    const formData = new FormData(form)
    setMessage(null)
    startTransition(async () => {
      const result = await addProjectEstimateBasisDocument(
        projectId,
        estimate.id,
        {
          documentType: formText(formData, "documentType"),
          title: formText(formData, "documentTitle"),
          documentDate: formText(formData, "documentDate"),
          revision: formText(formData, "revision"),
          driveUrl: formText(formData, "driveUrl"),
          notes: formText(formData, "documentNotes"),
        }
      )
      if (result.success) form.reset()
      finish(result.success ? "Estimate basis added." : result.error)
    })
  }

  function deleteBasisDocument(documentId: string, title: string): void {
    if (!estimate) return
    if (
      !window.confirm(
        `Remove “${title}” from this estimate basis? The Google Drive file will not be deleted.`
      )
    ) {
      return
    }
    setMessage(null)
    startTransition(async () => {
      const result = await deleteProjectEstimateBasisDocument(
        projectId,
        estimate.id,
        documentId
      )
      finish(result.success ? "Estimate basis reference removed." : result.error)
    })
  }

  function prepareForSignature(): void {
    if (!estimate) return
    setMessage(null)
    setSignatureMessage("Preparing the final signature package…")
    // Reserve the tab during the user gesture so popup blockers do not discard
    // the Foxit session after the asynchronous PDF and envelope work finishes.
    const foxitWindow = window.open("about:blank", "_blank")
    if (foxitWindow) {
      foxitWindow.opener = null
      foxitWindow.document.title = "Preparing Foxit signature package"
      foxitWindow.document.body.textContent =
        "Compass is preparing the estimate for Foxit. This tab will continue automatically."
    }
    startTransition(async () => {
      const result = await prepareProjectEstimateForClientSignature(
        projectId,
        estimate.id
      )
      const resultMessage = result.success
        ? "Signature package prepared. Review it in Foxit and use Foxit’s Send button only when it is ready. If the Foxit tab did not open, use Review and send in Foxit below."
        : result.error
      setSignatureMessage(resultMessage)
      finish(resultMessage)
      if (result.success) {
        if (foxitWindow) {
          foxitWindow.location.replace(result.embeddedSessionUrl)
        }
      } else {
        foxitWindow?.close()
      }
    })
  }

  function markSentOutsideCompass(): void {
    if (!estimate) return
    if (!window.confirm("Confirm that this exact version is being sent or printed for signatures outside Compass. It will become read-only; changes require a duplicate version.")) return
    setMessage(null)
    startTransition(async () => {
      const result = await markProjectEstimateSentOutsideCompass(projectId, estimate.id)
      finish(
        result.success
          ? "Version frozen for outside signatures. Upload or link the fully signed copy when complete."
          : result.error
      )
    })
  }

  function acceptManually(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!estimate) return
    const form = event.currentTarget
    const formData = new FormData(form)
    const fileValue = formData.get("acceptanceEvidenceFile")
    const file = fileValue instanceof File && fileValue.size > 0
      ? fileValue
      : null
    const linkedEvidenceUrl = formText(formData, "acceptanceEvidenceUrl")
    if (file && linkedEvidenceUrl) {
      setMessage("Choose either a file upload or an existing document link.")
      return
    }
    if (!file && !linkedEvidenceUrl) {
      setMessage("Upload or link the saved signed document.")
      return
    }

    setMessage(null)
    startTransition(async () => {
      try {
        const uploaded = file
          ? await uploadEstimateAcceptanceEvidence(file, projectId)
          : null
        const result = await recordManualProjectEstimateAcceptance(
          projectId,
          estimate.id,
          {
            acceptanceMethod: formText(formData, "acceptanceMethod"),
            clientAcceptedAt: formText(formData, "clientAcceptedAt"),
            evidenceUrl: uploaded?.url ?? linkedEvidenceUrl,
            evidenceLabel:
              uploaded?.label ?? formText(formData, "acceptanceEvidenceLabel"),
            acceptanceNote: formText(formData, "acceptanceNote"),
            attested: manualAcceptanceAttested,
          }
        )
        if (result.success) {
          form.reset()
          setManualAcceptanceAttested(false)
        }
        finish(
          result.success
            ? "Client acceptance recorded and the Budget/G703 was created."
            : result.error
        )
      } catch (error) {
        finish(
          error instanceof Error
            ? error.message
            : "Unable to upload the signed document."
        )
      }
    })
  }

  if (!estimate) {
    return (
      <section className="clarity-panel-strong p-6">
        <h2 className="text-lg font-semibold">Start the project estimate</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Start with a reviewed company template or a blank CA22 estimate. The
          resulting draft is independent and remains fully editable for this
          project.
        </p>
        {workspace.canEdit && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
            <div className="border-y py-4">
              <div className="flex items-center gap-2">
                <IconTemplate className="size-5 text-primary" />
                <h3 className="font-medium">Start from template</h3>
              </div>
              <div className="mt-3 space-y-3">
                <Select
                  value={startTemplateId}
                  onValueChange={setStartTemplateId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a published estimate template" />
                  </SelectTrigger>
                  <SelectContent>
                    {estimateTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name} · {template.lineCount} lines
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <SearchableCombobox
                  value={startTaxEntityId}
                  onValueChange={setStartTaxEntityId}
                  options={[
                    {
                      value: "",
                      label: "No project tax entity",
                      keywords: "none clear non-taxable",
                    },
                    ...taxEntityOptions,
                  ]}
                  ariaLabel="Project tax entity for the new estimate"
                  placeholder="Project tax entity, if applicable"
                  searchPlaceholder="Search Sage tax entities..."
                  emptyMessage="No matching Sage tax entities."
                  groupHeading="Active Sage tax entities"
                />
                {selectedStartTemplate?.requiresProjectTaxEntity && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    This template contains taxable lines. Select the project’s
                    tax entity before creating the draft.
                  </p>
                )}
                <Button
                  onClick={createEstimateFromTemplate}
                  disabled={
                    !startTemplateId ||
                    isPending ||
                    Boolean(
                      selectedStartTemplate?.requiresProjectTaxEntity &&
                        !startTaxEntityId
                    )
                  }
                >
                  <IconTemplate className="size-4" />
                  Create from template
                </Button>
                {estimateTemplates.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No published estimate templates are available yet.
                  </p>
                )}
              </div>
            </div>
            <div className="hidden items-center text-xs uppercase tracking-wide text-muted-foreground lg:flex">
              or
            </div>
            <div className="border-y py-4">
              <div className="flex items-center gap-2">
                <IconPlus className="size-5 text-primary" />
                <h3 className="font-medium">Start blank</h3>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Build the CSI divisions and cost-code lines manually.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={createEstimate}
                disabled={isPending}
              >
                <IconPlus className="size-4" />
                Create blank estimate
              </Button>
            </div>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="space-y-5">
      {message && (
        <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm">
          {message}
        </div>
      )}

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
            <ProjectEstimateVersionControls
              projectId={projectId}
              estimates={workspace.estimates}
              activeEstimate={estimate}
              canEdit={workspace.canEdit}
            />
            <Button variant="outline" asChild>
              <Link
                href={
                  acceptedDocumentUrl ??
                  `/print/projects/${projectId}/estimate?estimateId=${estimate.id}`
                }
                target="_blank"
              >
                <IconFileExport className="size-4" />
                {acceptedDocumentUrl
                  ? "Accepted proposal PDF"
                  : "Client report preview"}
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
              <p className="mt-1 text-lg font-semibold">{money(Number(value))}</p>
            </div>
          ))}
        </div>
      </section>

      <form className="clarity-panel-strong p-4" onSubmit={saveHeader}>
        <div className="mb-4 flex items-center gap-2">
          <IconFileDescription className="size-5 text-primary" />
          <h2 className="font-semibold">Estimate and contract basis</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          <span className="text-destructive" aria-hidden="true">*</span>{" "}
          Required before preparing the estimate for signature.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="estimateNumber">Estimate number</Label>
            <Input
              id="estimateNumber"
              name="estimateNumber"
              defaultValue={estimate.estimateNumber}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1.5 xl:col-span-2">
            <Label htmlFor="estimateTitle">Document name</Label>
            <Input
              id="estimateTitle"
              name="title"
              defaultValue={estimate.title}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estimateDate">
              Estimate date<SignatureRequiredMark />
            </Label>
            <Input
              id="estimateDate"
              name="estimateDate"
              type="date"
              defaultValue={estimate.estimateDate ?? ""}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="clientName">Client(s)</Label>
            <Input
              id="clientName"
              name="clientName"
              defaultValue={estimate.clientName ?? ""}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="clientMailingAddress">
              Prepared For mailing address
            </Label>
            <Textarea
              id="clientMailingAddress"
              name="clientMailingAddress"
              defaultValue={
                estimate.clientMailingAddress ??
                workspace.projectMailingAddress ??
                ""
              }
              rows={3}
              disabled={!editable}
            />
            <p className="text-xs text-muted-foreground">
              Defaults from the client mailing address on the project and can
              be customized for this estimate.
            </p>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="sourceWorkbookUrl">Source CSI workbook</Label>
            <Input
              id="sourceWorkbookUrl"
              name="sourceWorkbookUrl"
              type="url"
              defaultValue={estimate.sourceWorkbookUrl ?? ""}
              disabled={!editable}
            />
          </div>
          <div className="border-t pt-4 md:col-span-2 xl:col-span-4">
            <h3 className="text-sm font-semibold">Contract signers</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose a project contact or type a name. These details are
              included in the prepared signature package. Add every client or
              owner who must sign. Reference initials identify the signer in
              Compass; Foxit requires each signer to provide their own initials
              in the assigned fields.
            </p>
          </div>
          <div className="space-y-3 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Client / owner signers<SignatureRequiredMark /></Label>
              {editable && clientSigners.length < 10 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setClientSigners([
                      ...clientSigners,
                      { contactId: null, name: "", title: "", email: "", initials: "" },
                    ])
                  }
                >
                  <IconPlus className="size-4" />Add signer
                </Button>
              )}
            </div>
            {clientSigners.length === 0 && (
              <p className="text-xs text-muted-foreground">Add at least one client or owner signer.</p>
            )}
            {clientSigners.map((signer, index) => (
              <div key={`${estimate.id}-client-signer-${index}`} className="space-y-3 border-t pt-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Label htmlFor={`clientSignerName-${index}`}>
                      Signer {index + 1}<SignatureRequiredMark />
                    </Label>
                    <ProjectEstimateSignerPicker
                      id={`clientSignerName-${index}`}
                      value={signer}
                      options={workspace.signerContacts}
                      onValueChange={(value) =>
                        setClientSigners(clientSigners.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...value, initials: item.initials }
                            : item
                        ))
                      }
                      placeholder="Choose client signer or type a name..."
                      disabled={!editable}
                    />
                  </div>
                  {editable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Remove client signer ${index + 1}`}
                      onClick={() =>
                        setClientSigners(clientSigners.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_.55fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`clientSignerTitle-${index}`}>Title</Label>
                    <Input id={`clientSignerTitle-${index}`} value={signer.title} disabled={!editable} onChange={(event) => setClientSigners(clientSigners.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`clientSignerEmail-${index}`}>
                      Email<SignatureRequiredMark />
                    </Label>
                    <Input id={`clientSignerEmail-${index}`} type="email" value={signer.email} disabled={!editable} onChange={(event) => setClientSigners(clientSigners.map((item, itemIndex) => itemIndex === index ? { ...item, email: event.target.value } : item))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`clientSignerInitials-${index}`}>Reference initials</Label>
                    <Input id={`clientSignerInitials-${index}`} maxLength={6} value={signer.initials} disabled={!editable} onChange={(event) => setClientSigners(clientSigners.map((item, itemIndex) => itemIndex === index ? { ...item, initials: event.target.value.toUpperCase() } : item))} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-3 md:col-span-2">
            <div className="space-y-1.5">
              <Label htmlFor="companySignerName">
                Company representative<SignatureRequiredMark />
              </Label>
              <ProjectEstimateSignerPicker
                id="companySignerName"
                value={companySigner}
                options={workspace.signerContacts}
                onValueChange={setCompanySigner}
                placeholder="Choose company representative or type a name..."
                disabled={!editable}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_.55fr]">
              <div className="space-y-1.5">
                <Label htmlFor="companySignerTitle">
                  Title<SignatureRequiredMark />
                </Label>
                <Input
                  id="companySignerTitle"
                  value={companySigner.title}
                  onChange={(event) =>
                    setCompanySigner({
                      ...companySigner,
                      title: event.target.value,
                    })
                  }
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companySignerEmail">
                  Email<SignatureRequiredMark />
                </Label>
                <Input
                  id="companySignerEmail"
                  type="email"
                  value={companySigner.email}
                  onChange={(event) =>
                    setCompanySigner({
                      ...companySigner,
                      email: event.target.value,
                    })
                  }
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companySignerInitials">Reference initials</Label>
                <Input
                  id="companySignerInitials"
                  maxLength={6}
                  value={companySignerInitials}
                  onChange={(event) =>
                    setCompanySignerInitials(event.target.value.toUpperCase())
                  }
                  disabled={!editable}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="defaultTaxEntityId">Project tax entity</Label>
            <input
              type="hidden"
              name="defaultTaxEntityId"
              value={defaultTaxEntityId}
            />
            <SearchableCombobox
              id="defaultTaxEntityId"
              value={defaultTaxEntityId}
              onValueChange={(value) => {
                setDefaultTaxEntityId(value)
                setLine((current) =>
                  current.taxable && !current.taxEntityId
                    ? { ...current, taxEntityId: value }
                    : current
                )
              }}
              disabled={!editable}
              options={[
                {
                  value: "",
                  label: "No project tax entity",
                  keywords: "none clear non-taxable",
                },
                ...taxEntityOptions,
              ]}
              ariaLabel="Project tax entity"
              placeholder="Select a Sage tax entity"
              searchPlaceholder="Search Sage tax entities..."
              emptyMessage="No matching Sage tax entities."
              groupHeading="Active Sage tax entities"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="termsTemplateId">Contract terms template</Label>
            <Select
              name="termsTemplateId"
              value={termsTemplateId}
              onValueChange={(value) => {
                setTermsTemplateId(value)
                setContractTerms(
                  selectedTemplateBody(workspace.termsTemplates, value)
                )
              }}
              disabled={!editable}
            >
              <SelectTrigger id="termsTemplateId">
                <SelectValue placeholder="Choose a terms template" />
              </SelectTrigger>
              <SelectContent>
                {workspace.termsTemplates.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {workspace.termsTemplates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No {workspace.department}-department terms templates are
                available yet. Enter estimate-specific terms below.
              </p>
            )}
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="introductionTemplateId">
              Introductory text template
            </Label>
            <Select
              name="introductionTemplateId"
              value={introductionTemplateId}
              onValueChange={(value) => {
                setIntroductionTemplateId(value)
                setIntroductionText(
                  selectedTemplateBody(workspace.introductionTemplates, value)
                )
              }}
              disabled={!editable || workspace.introductionTemplates.length === 0}
            >
              <SelectTrigger id="introductionTemplateId">
                <SelectValue placeholder="Choose introductory copy" />
              </SelectTrigger>
              <SelectContent>
                {workspace.introductionTemplates.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="closingTemplateId">Closing text template</Label>
            <Select
              name="closingTemplateId"
              value={closingTemplateId}
              onValueChange={(value) => {
                setClosingTemplateId(value)
                setClosingText(
                  selectedTemplateBody(workspace.closingTemplates, value)
                )
              }}
              disabled={!editable || workspace.closingTemplates.length === 0}
            >
              <SelectTrigger id="closingTemplateId">
                <SelectValue placeholder="Choose closing copy" />
              </SelectTrigger>
              <SelectContent>
                {workspace.closingTemplates.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label htmlFor="introductionText">
              Client report introduction
            </Label>
            <Textarea
              id="introductionText"
              name="introductionText"
              rows={4}
              value={introductionText}
              onChange={(event) => setIntroductionText(event.target.value)}
              disabled={!editable}
              placeholder="Optional editable text shown before the estimate detail."
            />
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label htmlFor="contractTerms">
              Pertinent contract terms<SignatureRequiredMark />
            </Label>
            <Textarea
              id="contractTerms"
              name="contractTerms"
              rows={6}
              value={contractTerms}
              onChange={(event) => setContractTerms(event.target.value)}
              disabled={!editable}
              placeholder="Use a template or draft the estimate-specific terms here."
            />
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label htmlFor="closingText">Client report closing text</Label>
            <Textarea
              id="closingText"
              name="closingText"
              rows={4}
              value={closingText}
              onChange={(event) => setClosingText(event.target.value)}
              disabled={!editable}
              placeholder="Optional editable text shown after the estimate detail."
            />
          </div>
        </div>
        {editable && (
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={isPending}>Save draft details</Button>
          </div>
        )}
      </form>

      <ProjectEstimateClientReportSettings
        projectId={projectId}
        workspace={workspace}
        estimate={estimate}
        editable={editable}
      />

      <section className="clarity-panel-strong p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">CSI estimate</h2>
            <p className="text-xs text-muted-foreground">
              Select a division first, then add the cost codes needed within
              it. Each division subtotal updates from its lines.
            </p>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <ProjectEstimatePlanSwiftImport
                projectId={projectId}
                estimateId={estimate.id}
                costCodes={workspace.costCodes}
                existingLineCount={workspace.lines.length}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => openLineEditor(EMPTY_LINE)}
              >
                <IconPlus className="size-4" />
                Add estimate line
              </Button>
              {estimate.sourceWorkbookUrl && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={importSourceCsi}
                  disabled={isPending}
                >
                  <IconRefresh
                    className={isPending ? "size-4 animate-spin" : "size-4"}
                  />
                  Import source CSI
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Overhead, margin, and contingency are builder-fee percentages applied
          to eligible estimate items. They remain separate from Sage cost-code
          lines until their accounting mappings are assigned.
        </p>
        <div className="mb-5 grid gap-4 border-y py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <form key={`markup-${estimate.id}-${estimate.updatedAt}`} onSubmit={applyLineMarkup}>
            <h3 className="text-sm font-semibold">Apply one line markup</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Replaces the markup percentage on every current estimate line.
            </p>
            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="bulkMarkupPercent">Markup %</Label>
                <Input
                  id="bulkMarkupPercent"
                  name="bulkMarkupPercent"
                  inputMode="decimal"
                  defaultValue={workspace.lines[0]?.markupRateBasisPoints
                    ? workspace.lines[0].markupRateBasisPoints / 100
                    : 0}
                  disabled={!editable}
                />
              </div>
              <Button type="submit" variant="outline" disabled={!editable || isPending || workspace.lines.length === 0}>
                Apply to all lines
              </Button>
            </div>
          </form>
          <form key={`builder-fee-${estimate.id}-${estimate.updatedAt}`} onSubmit={saveBuilderFee}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Builder fee</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Eligible cost base {money(estimate.builderFeeBaseCents)}
                </p>
              </div>
              <p className="font-semibold">{money(estimate.builderFeeCents)}</p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="overheadPercent">Overhead %</Label>
                <Input id="overheadPercent" name="overheadPercent" inputMode="decimal" defaultValue={estimate.overheadRateBasisPoints / 100} disabled={!editable} />
                <p className="text-xs text-muted-foreground">{money(estimate.overheadCents)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="marginPercent">Margin %</Label>
                <Input id="marginPercent" name="marginPercent" inputMode="decimal" defaultValue={estimate.marginRateBasisPoints / 100} disabled={!editable} />
                <p className="text-xs text-muted-foreground">{money(estimate.marginCents)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contingencyPercent">Contingency reserve %</Label>
                <Input id="contingencyPercent" name="contingencyPercent" inputMode="decimal" defaultValue={estimate.contingencyRateBasisPoints / 100} disabled={!editable} />
                <p className="text-xs text-muted-foreground">{money(estimate.contingencyCents)}</p>
              </div>
            </div>
            {editable && (
              <div className="mt-3 flex justify-end">
                <Button type="submit" disabled={isPending}>Update builder fee</Button>
              </div>
            )}
          </form>
        </div>
        {groupedLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No estimate lines yet.</p>
        ) : (
          <div className="space-y-4">
            {groupedLines.map(([divisionCode, items]) => {
              const subtotal = items.reduce(
                (sum, item) => sum + item.lineTotalCents,
                0
              )
              return (
                <div key={divisionCode} className="border-l-2 border-l-primary pl-4">
                  <div className="flex items-center justify-between gap-3 border-b pb-2">
                    <div>
                      <h3 className="text-sm font-semibold">
                        {divisionCode} · {items[0]?.divisionName}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {items.length} cost-code {items.length === 1 ? "line" : "lines"}
                      </p>
                    </div>
                    <p className="font-semibold">{money(subtotal)}</p>
                  </div>
                  <div className="divide-y">
                    {items.map((item) => (
                      <div key={item.id} className="py-3">
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                          <div>
                            <p className="text-sm font-medium">
                              {item.costCode} · {item.costCodeName}
                            </p>
                            {item.description.trim() !==
                              item.costCodeName.trim() && (
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {item.description}
                              </p>
                            )}
                            {!mappedCostCodes.has(item.costCode) && (
                              <Badge variant="outline" className="mt-1">
                                Sage mapping required
                              </Badge>
                            )}
                            {!item.includeInBuilderFee && (
                              <Badge variant="outline" className="mt-1 ml-1">
                                Builder fee excluded
                              </Badge>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {item.costItems.length > 0
                                ? `${item.costItems.length} cost-code breakdown · direct ${money(item.directCostCents)} · markup ${money(item.markupCents)} · tax ${money(item.taxCents)}`
                                : `${item.quantity} ${item.unit} × ${money(item.unitCostCents)} · markup ${percent(item.markupRateBasisPoints)}${item.taxable ? ` · ${item.taxCode ?? "tax"} ${percent(item.taxRateBasisPoints)}` : " · non-taxable"}`}
                            </p>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-medium">{money(item.lineTotalCents)}</span>
                            {editable && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openLineEditor(lineDraft(item))}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    openLineEditor(
                                      {
                                        ...EMPTY_LINE,
                                        divisionCode: item.divisionCode,
                                      },
                                      item.id
                                    )
                                  }
                                >
                                  Insert below
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Delete ${item.description}`}
                                  onClick={() => removeLine(item.id)}
                                >
                                  <IconTrash className="size-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        <ProjectEstimateLineBreakdown
                          projectId={projectId}
                          estimateId={estimate.id}
                          line={item}
                          costCodes={workspace.costCodes}
                          taxEntities={workspace.taxEntities}
                          defaultTaxRateBasisPoints={
                            estimate.defaultTaxRateBasisPoints
                          }
                          defaultTaxEntityId={defaultTaxEntityId}
                          editable={editable}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            <div className="ml-auto max-w-sm space-y-2 border-t pt-3 text-sm">
              <div className="flex justify-between gap-4">
                <span>Project subtotal</span>
                <span>{money(estimate.directCostCents + estimate.markupCents + estimate.taxCents)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Builder fee</span>
                <span>{money(estimate.builderFeeCents)}</span>
              </div>
              <div className="flex justify-between gap-4 font-semibold">
                <span>Estimate total</span>
                <span>{money(estimate.estimateTotalCents)}</span>
              </div>
            </div>
          </div>
        )}

        {editable && (
          <form
            ref={lineEditorRef}
            className="mt-5 scroll-mt-6 border-t pt-4"
            onSubmit={saveLine}
          >
            <h3 className="mb-3 text-sm font-semibold">
              {line.id
                ? "Edit estimate line"
                : insertAfterLineId
                  ? "Insert estimate line"
                  : "Add estimate line"}
            </h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <Label>CSI division</Label>
                <Select
                  value={line.divisionCode}
                  onValueChange={(value) =>
                    setLine({ ...line, divisionCode: value, costCode: "" })
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Choose division first" /></SelectTrigger>
                  <SelectContent>
                    {divisions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 xl:col-span-2">
                <Label>Cost code</Label>
                <SearchableCombobox
                  ariaLabel="Estimate cost code"
                  options={availableCostCodes}
                  value={line.costCode}
                  onValueChange={(value) => setLine({ ...line, costCode: value })}
                  disabled={!line.divisionCode}
                  placeholder="Choose cost code"
                  searchPlaceholder="Search Sage cost codes..."
                  emptyMessage="No matching Sage cost codes."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimateUnit">Unit type</Label>
                <EstimateUnitInput
                  id="estimateUnit"
                  name="unit"
                  value={line.unit}
                  disabled={lineUsesCostBreakdown}
                  onValueChange={(value) => setLine({ ...line, unit: value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                <Label htmlFor="estimateDescription">Description</Label>
                <Input id="estimateDescription" name="description" value={line.description} onChange={(event) => setLine({ ...line, description: event.target.value })} required />
              </div>
              <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                <Label htmlFor="estimateSpecifications">Specifications / scope notes</Label>
                <Textarea id="estimateSpecifications" name="specifications" value={line.specifications} onChange={(event) => setLine({ ...line, specifications: event.target.value })} rows={3} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimateQuantity">Quantity</Label>
                <Input id="estimateQuantity" name="quantity" inputMode="decimal" value={line.quantity} disabled={lineUsesCostBreakdown} onChange={(event) => setLine({ ...line, quantity: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimateUnitCost">Unit cost</Label>
                <Input id="estimateUnitCost" name="unitCost" inputMode="decimal" value={line.unitCost} disabled={lineUsesCostBreakdown} onChange={(event) => setLine({ ...line, unitCost: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimateMarkup">Line markup %</Label>
                <Input id="estimateMarkup" name="markupPercent" inputMode="decimal" value={line.markupPercent} disabled={lineUsesCostBreakdown} onChange={(event) => setLine({ ...line, markupPercent: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tax entity</Label>
                <SearchableCombobox
                  value={line.taxEntityId}
                  onValueChange={(value) =>
                    setLine({ ...line, taxEntityId: value })
                  }
                  disabled={!line.taxable || lineUsesCostBreakdown}
                  options={[
                    {
                      value: "",
                      label: "Use project tax entity",
                      keywords: "default inherit clear",
                    },
                    ...taxEntityOptions,
                  ]}
                  ariaLabel="Estimate line tax entity"
                  placeholder="Use project tax entity"
                  searchPlaceholder="Search Sage tax entities..."
                  emptyMessage="No matching Sage tax entities."
                  groupHeading="Active Sage tax entities"
                />
              </div>
              {lineUsesCostBreakdown && (
                <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-4">
                  Quantity, unit, unit cost, markup, and tax are calculated from
                  this line&apos;s expanded cost-code breakdown. Edit those pricing
                  values inside the breakdown above.
                </p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={line.taxable}
                  disabled={lineUsesCostBreakdown}
                  onCheckedChange={(checked) => {
                    const taxable = checked === true
                    setLine({
                      ...line,
                      taxable,
                      taxEntityId:
                        taxable && !line.taxEntityId
                          ? defaultTaxEntityId
                          : line.taxEntityId,
                    })
                  }}
                />
                Taxable line
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={line.ownerVisible} onCheckedChange={(checked) => setLine({ ...line, ownerVisible: checked === true })} />
                Owner-visible
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={line.includeInBuilderFee} onCheckedChange={(checked) => setLine({ ...line, includeInBuilderFee: checked === true })} />
                Include cost in builder-fee calculation
              </label>
              <div className="ml-auto flex gap-2">
                {(line.id || insertAfterLineId) && <Button type="button" variant="ghost" onClick={() => { setLine(EMPTY_LINE); setInsertAfterLineId(null) }}>Cancel</Button>}
                <Button type="submit" disabled={isPending || !line.costCode}>
                  <IconPlus className="size-4" /> {line.id ? "Save line" : insertAfterLineId ? "Insert line" : "Add line"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </section>

      <section className="clarity-panel-strong p-4">
        <h2 className="font-semibold">Plans, specifications, and estimate basis</h2>
        <div className="mt-3 divide-y">
          {workspace.basisDocuments.map((document) => (
            <div key={document.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div>
                <p className="font-medium">{document.title}</p>
                <p className="text-xs text-muted-foreground">
                  {statusLabel(document.documentType)} · {document.documentDate ?? "date not set"}
                  {document.revision ? ` · revision ${document.revision}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {document.driveUrl && <Button variant="outline" size="sm" asChild><Link href={document.driveUrl} target="_blank">Open</Link></Button>}
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    aria-label={`Remove ${document.title} from estimate basis`}
                    disabled={isPending}
                    onClick={() => deleteBasisDocument(document.id, document.title)}
                  >
                    <IconTrash className="size-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {editable && (
          <form className="mt-3 grid gap-3 border-t pt-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={addBasis}>
            <div className="space-y-1.5">
              <Label htmlFor="documentType">Type</Label>
              <Select name="documentType" defaultValue="architectural_plans">
                <SelectTrigger id="documentType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="architectural_plans">Architectural plans</SelectItem>
                  <SelectItem value="structural_plans">Structural plans</SelectItem>
                  <SelectItem value="specifications">Specifications</SelectItem>
                  <SelectItem value="geotechnical">Geotechnical</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 xl:col-span-2"><Label htmlFor="documentTitle">Title</Label><Input id="documentTitle" name="documentTitle" required /></div>
            <div className="space-y-1.5"><Label htmlFor="basisDate">Document date</Label><Input id="basisDate" name="documentDate" type="date" /></div>
            <div className="space-y-1.5"><Label htmlFor="basisRevision">Revision</Label><Input id="basisRevision" name="revision" /></div>
            <div className="space-y-1.5 xl:col-span-2"><Label htmlFor="basisDriveUrl">Google Drive link</Label><Input id="basisDriveUrl" name="driveUrl" type="url" /></div>
            <div className="flex items-end"><Button type="submit" disabled={isPending}><IconPlus className="size-4" />Add basis</Button></div>
          </form>
        )}
      </section>

      <section className="clarity-panel-strong p-4">
        <div className="flex items-start gap-3">
          <IconReceiptTax className="mt-0.5 size-5 text-primary" />
          <div className="flex-1">
            <h2 className="font-semibold">Approval and accounting handoff</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Prepare and review the final package without locking the estimate.
              When it is sent from Foxit, this version is frozen against edits.
              It locks automatically only after every required signer finishes,
              or after a complete manually signed copy is recorded.
            </p>
            <div className="mt-3 border-y py-3">
              <p className="text-sm font-medium">Choose the signature route</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Send this estimate by itself for H, N, D, and change-order work,
                or assemble the estimate as CA22 inside a full construction contract packet.
              </p>
              <Button className="mt-3" variant="outline" asChild>
                <Link href={`/dashboard/projects/${projectId}/contracts`}>
                  <IconFileDescription className="size-4" />Full construction contract
                </Link>
              </Button>
            </div>
            {editable && (
              <Button className="mt-3" onClick={prepareForSignature} disabled={isPending || workspace.lines.length === 0}>
                <IconSend className="size-4" />Prepare estimate-only version for client signature
              </Button>
            )}
            {editable && (
              <Button className="ml-2 mt-3" variant="outline" onClick={markSentOutsideCompass} disabled={isPending || workspace.lines.length === 0}>
                Sent / printed for signatures outside Compass
              </Button>
            )}
            {editable && estimate.foxitStatus === "preparing" && estimate.foxitEmbeddedSessionUrl && (
              <Button className="ml-2 mt-3" variant="outline" asChild>
                <Link href={estimate.foxitEmbeddedSessionUrl} target="_blank">
                  Review and send in Foxit
                </Link>
              </Button>
            )}
            {editable && !estimate.contractTerms?.trim() && (
              <p className="mt-3 text-sm text-muted-foreground">
                Contract terms are required. Add and save them above before
                preparing the final signature package.
              </p>
            )}
            {signatureMessage && (
              <div
                className="mt-3 rounded-md border bg-muted/35 px-3 py-2 text-sm"
                role="status"
                aria-live="polite"
              >
                {signatureMessage}
              </div>
            )}
            {estimate.status === "signature_pending" && workspace.canEdit && (
              <div className="mt-4 space-y-5 border-t pt-4">
                {estimate.foxitStatus !== "not_applicable" && (
                  <div>
                    <h3 className="text-sm font-semibold">Foxit signatures in progress</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This version is read-only. Compass will accept and lock it automatically after Foxit confirms that every required signer has completed the envelope.
                    </p>
                  </div>
                )}

                <form className="space-y-4 border-t pt-4" onSubmit={acceptManually}>
                  <div>
                    <h3 className="text-sm font-semibold">Client signed outside Compass</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Upload the scanned contract to the project&apos;s Google Drive
                      folder or link the saved signed document.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="acceptanceMethod">Signature method</Label>
                      <Select name="acceptanceMethod" required>
                        <SelectTrigger id="acceptanceMethod"><SelectValue placeholder="Choose method" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="wet_signature">Printed and signed document</SelectItem>
                          <SelectItem value="external_esignature">External eSignature</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="clientAcceptedAt">Contract execution date</Label>
                      <Input id="clientAcceptedAt" name="clientAcceptedAt" type="date" max={localDateInput()} defaultValue={localDateInput()} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="acceptanceEvidenceFile">Upload signed document</Label>
                      <Input id="acceptanceEvidenceFile" name="acceptanceEvidenceFile" type="file" accept="application/pdf,image/*,.doc,.docx" />
                      <p className="text-xs text-muted-foreground">PDF, Word, or image; 50 MB maximum.</p>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="acceptanceEvidenceUrl">Or link an existing signed document</Label>
                      <Input id="acceptanceEvidenceUrl" name="acceptanceEvidenceUrl" type="url" placeholder="https://drive.google.com/..." />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="acceptanceEvidenceLabel">Document label</Label>
                      <Input id="acceptanceEvidenceLabel" name="acceptanceEvidenceLabel" placeholder="Signed construction estimate" />
                      <p className="text-xs text-muted-foreground">Required for a link; uploads use the filename.</p>
                    </div>
                    <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                      <Label htmlFor="acceptanceNote">Acceptance note</Label>
                      <Textarea id="acceptanceNote" name="acceptanceNote" placeholder="Optional context about how the signed contract was received." maxLength={2000} />
                    </div>
                  </div>
                  <div className="flex items-start gap-2 border-t pt-3">
                    <Checkbox id="manualAcceptanceAttestation" checked={manualAcceptanceAttested} onCheckedChange={(checked) => setManualAcceptanceAttested(checked === true)} />
                    <Label htmlFor="manualAcceptanceAttestation" className="max-w-3xl text-sm font-normal leading-5">
                      I confirm this document contains the required client and
                      company representative signatures and matches this locked
                      estimate version.
                    </Label>
                  </div>
                  <Button type="submit" variant="outline" disabled={isPending || !manualAcceptanceAttested}>
                    <IconUpload className="size-4" />Record executed contract and create Budget/G703
                  </Button>
                </form>
              </div>
            )}
            {estimate.status === "accepted" && (
              <div className="mt-4 border-t pt-4 text-sm">
                <p className="font-medium text-emerald-700">
                  Accepted estimate is locked. Budget changes now require an executed change order.
                </p>
                <dl className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Acceptance method</dt>
                    <dd>
                      {isEstimateAcceptanceMethod(estimate.acceptanceMethod)
                        ? estimateAcceptanceMethodLabel(estimate.acceptanceMethod)
                        : "Previously recorded acceptance"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Acceptance date</dt>
                    <dd>
                      {acceptedEstimateDateLabel(
                        estimate.signedAt ?? estimate.acceptedAt
                      )}
                    </dd>
                  </div>
                  {estimate.acceptanceRecordedByName && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Recorded by</dt>
                      <dd>{estimate.acceptanceRecordedByName}</dd>
                    </div>
                  )}
                  {estimate.acceptanceNote && (
                    <div className="md:col-span-2">
                      <dt className="text-xs text-muted-foreground">Acceptance note</dt>
                      <dd className="whitespace-pre-wrap">{estimate.acceptanceNote}</dd>
                    </div>
                  )}
                </dl>
                {acceptedEvidenceUrl && (
                  <Button className="mt-3" variant="outline" size="sm" asChild>
                    <Link href={acceptedEvidenceUrl} target="_blank">
                      <IconFileDescription className="size-4" />
                      {estimate.acceptanceEvidenceLabel ?? "Open signed estimate"}
                    </Link>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
