"use client"

import { toast } from "sonner"
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
  IconEye,
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
import type { ProjectFamilySummary } from "@/app/actions/project-families"

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
import { createEstimateLineTakeoffTodo } from "@/app/actions/estimate-line-pricing"
import { EstimateLinePricedBy, EstimateLinePricingBadge, needsTakeoffTodo, useEstimatePricingView } from "@/components/projects/estimate-line-priced-by"
import {
  ESTIMATE_WORK_SECTIONS,
  isEstimateWorkSection,
  type EstimateWorkSection,
} from "@/lib/estimates/workspace-sections"
import { ProjectEstimateLineOrder } from "@/components/projects/project-estimate-line-order"
import { EstimateVersionAcceptanceFields } from "@/components/projects/estimate-version-acceptance-fields"
import { compareEstimateLineOrder } from "@/lib/estimates/line-order"
import { groupEstimateAssemblies } from "@/lib/estimates/assemblies"
import { ProjectEstimateAssemblyEditor } from "@/components/projects/project-estimate-assembly-editor"
import { EstimatePhaseExportButton, ProjectEstimatePhaseProposals } from "@/components/projects/project-estimate-phase-proposals"
import type { ProjectPhaseProposalSummary } from "@/app/actions/estimate-phase-proposals"
import type { EstimateAssemblyCopySummary } from "@/app/actions/estimate-project-copies"
import { EstimateAssemblyCopyNotes, EstimateCopyToProjectButton } from "@/components/projects/estimate-copy-to-project"
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
import { ProjectEstimateBuildertrendImport } from "@/components/projects/project-estimate-buildertrend-import"
import { ProjectEstimateVersionControls } from "@/components/projects/project-estimate-version-controls"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { RateBookFillPicker } from "@/components/rate-book/rate-book-fill-picker"
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
  acceptedEstimateEvidenceUrl,
} from "@/lib/estimates/accepted-document"
import { calculateEstimateLine } from "@/lib/financials/estimate-ledger"

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
  return (
    <span className="text-destructive" aria-hidden="true">
      {" "}
      *
    </span>
  )
}

function formText(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim()
  return value.length > 0 ? value : null
}

function formNumber(formData: FormData, name: string): number | null {
  const value = Number(String(formData.get(name) ?? "").replaceAll(",", ""))
  return Number.isFinite(value) ? value : null
}

function draftNumber(value: string): number {
  const parsed = Number(value.replaceAll(",", ""))
  return Number.isFinite(parsed) ? parsed : 0
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
  readonly assemblyId: string | null
  readonly id: string | null
  readonly reportPhaseId: string
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
  /** "Priced by" choice id; "" when not chosen. */
  readonly pricingSource: string
  /** Estimator for a new takeoff to-do; "" makes none. */
  readonly takeoffEstimatorId: string
}

const EMPTY_LINE: LineDraft = {
  assemblyId: null,
  id: null,
  reportPhaseId: "",
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
  pricingSource: "",
  takeoffEstimatorId: "",
}

function lineDraft(line: ProjectEstimateLineItem): LineDraft {
  return {
    assemblyId: line.assemblyId,
    id: line.id,
    reportPhaseId: line.reportPhaseId ?? "",
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
    pricingSource: "",
    takeoffEstimatorId: "",
  }
}

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
  const acceptedEvidenceUrl = estimate
    ? acceptedEstimateEvidenceUrl(estimate)
    : null
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
  const [buildView, setBuildView] = useState<"division" | "assembly">(
    "division"
  )
  const [line, setLine] = useState<LineDraft>(EMPTY_LINE)
  const pricing = useEstimatePricingView(projectId, estimate?.id ?? null)
  const [insertAfterLineId, setInsertAfterLineId] = useState<string | null>(
    null
  )
  const lineEditorRef = useRef<HTMLFormElement>(null)
  // Group whose "Add item" opened the editor, so it opens at that group's end.
  const [addToGroupKey, setAddToGroupKey] = useState<string | null>(null)
  const [startTemplateId, setStartTemplateId] = useState("")
  const [basisProjectDocumentId, setBasisProjectDocumentId] = useState("")
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

  const lastLoadedHeader = useRef<string | null>(null)
  const persistedHeader = JSON.stringify([
    estimate?.id, estimate?.defaultTaxEntityId, estimate?.termsTemplateId,
    estimate?.contractTerms, estimate?.introductionTemplateId, estimate?.introductionText,
    estimate?.closingTemplateId, estimate?.closingText, estimate?.clientSigners,
    estimate?.companySignerContactId, estimate?.companySignerName, estimate?.companySignerTitle,
    estimate?.companySignerEmail, estimate?.companySignerInitials,
  ])
  useEffect(() => {
    // Line-order saves refresh the workspace. Equivalent signer arrays from the
    // server must not reset unfinished header fields in another input area.
    if (lastLoadedHeader.current === persistedHeader) return
    lastLoadedHeader.current = persistedHeader
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
    persistedHeader,
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
  const effectiveLineTaxEntityId = line.taxEntityId || defaultTaxEntityId
  const effectiveLineTaxEntity = workspace.taxEntities.find(
    (option) => option.value === effectiveLineTaxEntityId
  )
  const linePreview = calculateEstimateLine({
    quantity: draftNumber(line.quantity),
    unitCostCents: Math.round(Math.max(0, draftNumber(line.unitCost)) * 100),
    markupRateBasisPoints: Math.round(
      Math.max(0, draftNumber(line.markupPercent)) * 100
    ),
    taxable: line.taxable,
    taxRateBasisPoints: effectiveLineTaxEntity?.rateBasisPoints ?? 0,
  })
  const groupedLines = useMemo(() => {
    if (buildView === "assembly") return groupEstimateAssemblies(workspace.assemblies, workspace.lines).map((group) => ({
      key: group.id ?? "unassigned", assemblyId: group.id, name: group.name, description: group.description, items: group.lines,
    }))
    const groups = new Map<string, ProjectEstimateLineItem[]>()
    for (const item of workspace.lines) {
      const current = groups.get(item.divisionCode) ?? []
      current.push(item)
      groups.set(item.divisionCode, current)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([divisionCode, items]) => ({
      key: divisionCode, assemblyId: null, name: `${divisionCode} · ${items[0]?.divisionName}`, description: null, items: items.sort(compareEstimateLineOrder),
    }))
  }, [workspace.lines, workspace.assemblies, buildView])
  // What "Copy to another job" can offer: each assembly with its item count.
  const copyGroups = useMemo(() => workspace.assemblies.map((assembly) => ({
    id: assembly.id,
    name: assembly.name,
    lineCount: workspace.lines.filter((line) => line.assemblyId === assembly.id).length,
  })), [workspace.assemblies, workspace.lines])
  const unassignedLineCount = workspace.lines.filter((line) => line.assemblyId === null).length
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
          reportPhaseId: line.reportPhaseId || null,
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
          assemblyId: line.assemblyId,
          insertAfterLineId,
          pricingSource: line.pricingSource || null,
        }
      )
      let saved = result.success ? "Estimate line saved." : result.error
      if (result.success && pricing.view && needsTakeoffTodo(pricing.view.sources, line.pricingSource, line.takeoffEstimatorId, pricing.view.lines[result.id])) {
        const todo = await createEstimateLineTakeoffTodo(projectId, estimate.id, result.id, line.takeoffEstimatorId)
        saved = todo.success
          ? `Estimate line saved. Takeoff to-do made for ${todo.data.assigneeName ?? "the estimator"}.`
          : `Estimate line saved, but the takeoff to-do wasn't made: ${todo.error}`
      }
      if (result.success) {
        closeLineEditor()
        pricing.reload()
      }
      finish(saved)
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
    insertionPoint: string | null = null,
    groupKey: string | null = null
  ): void {
    setLine(nextLine)
    setInsertAfterLineId(insertionPoint)
    setAddToGroupKey(groupKey)
    window.requestAnimationFrame(() => {
      const description = lineEditorRef.current
        ?.querySelector<HTMLInputElement>("#estimateDescription")
      // The editor opens right under the line, so only nudge it into view
      // when part of it is off screen; the person keeps their place.
      lineEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      description?.focus({ preventScroll: true })
    })
  }

  function closeLineEditor(): void {
    setLine(EMPTY_LINE)
    setInsertAfterLineId(null)
    setAddToGroupKey(null)
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
          projectDocumentId: basisProjectDocumentId,
          documentType: formText(formData, "documentType"),
          title: formText(formData, "documentTitle"),
          documentDate: formText(formData, "documentDate"),
          revision: formText(formData, "revision"),
          driveUrl: formText(formData, "driveUrl"),
          notes: formText(formData, "documentNotes"),
        }
      )
      if (result.success) {
        form.reset()
        setBasisProjectDocumentId("")
      }
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
    if (!file && !linkedEvidenceUrl && estimate.foxitStatus !== "completed") {
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
            versionTreatment: formText(formData, "versionTreatment"),
            versionSummary: formText(formData, "versionSummary"),
          }
        )
        if (result.success) {
          form.reset()
          setManualAcceptanceAttested(false)
        }
        finish(
          result.success
            ? acceptanceChangesContract
              ? "Client acceptance recorded; the change order and Budget/G703 were updated."
              : "Client acceptance recorded and the Budget/G703 was created."
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
                <SearchableCombobox
                  value={startTemplateId}
                  onValueChange={setStartTemplateId}
                  options={estimateTemplates.map((template) => ({
                    value: template.id,
                    label: template.name,
                    description: `${template.lineCount} lines`,
                  }))}
                  ariaLabel="Estimate template"
                  placeholder="Choose a published estimate template"
                  searchPlaceholder="Search estimate templates..."
                  emptyMessage="No matching templates."
                />
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
                  <p className="text-xs text-warning">
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

  // The line editor opens where the person is working: under the line being
  // edited or inserted after, at the end of the assembly it's added to, or at
  // the bottom for a new line. Only one copy renders at a time (field ids).
  // Falls back to the bottom when the anchor isn't on screen (e.g. the view
  // switched between division and assembly, or the line was removed).
  const editorIsInline = line.id
    ? groupedLines.some((group) => group.items.some((item) => item.id === line.id))
    : insertAfterLineId
      ? groupedLines.some((group) => group.items.some((item) => item.id === insertAfterLineId))
      : addToGroupKey !== null && groupedLines.some((group) => group.key === addToGroupKey)

  function renderLineEditor(placement: "inline" | "bottom"): React.ReactElement {
    return (
            <form
            ref={lineEditorRef}
            className={placement === "inline" ? "max-w-5xl scroll-mt-24 border-y bg-muted/30 px-3 py-4" : "mt-5 max-w-5xl scroll-mt-6 border-t pt-4"}
            onSubmit={saveLine}
          >
              <h3 className="mb-3 text-sm font-semibold">
              {line.id
                ? "Edit estimate line"
                : insertAfterLineId
                  ? "Insert estimate line"
                  : "Add estimate line"}
            </h3>
              <div className="mb-3 max-w-sm space-y-1.5">
                <Label htmlFor="estimate-line-assembly">Assembly</Label>
                <SearchableCombobox
                  id="estimate-line-assembly"
                  ariaLabel="Assembly"
                  placeholder="Choose assembly"
                  value={line.assemblyId ?? "none"}
                  options={[
                    { value: "none", label: "Other work (no assembly)" },
                    ...workspace.assemblies.map((assembly) => ({
                      value: assembly.id,
                      label: assembly.name,
                      description: assembly.description ?? undefined,
                    })),
                  ]}
                  onValueChange={(value) =>
                    setLine({
                      ...line,
                      assemblyId: value === "none" ? null : value,
                    })
                  }
                />
              </div>
              {!lineUsesCostBreakdown ? (
                <RateBookFillPicker
                  key={line.id ?? "new"}
                  id="estimate-line-rate-book"
                  projectId={projectId}
                  className="mb-3 max-w-sm space-y-1.5"
                  onPick={(option) => {
                    // The cost code depends on the work: a rate's default code
                    // only fills a line that has none yet.
                    const code = option.costCode && !line.costCode
                      ? workspace.costCodes.find((candidate) => candidate.value === option.costCode)
                      : undefined
                    setLine({
                      ...line,
                      divisionCode: code?.divisionCode ?? line.divisionCode,
                      costCode: code?.value ?? line.costCode,
                      description: line.description || option.description,
                      unit: option.unit,
                      unitCost: String(option.unitCostCents / 100),
                      markupPercent: String(option.markupBasisPoints / 100),
                    })
                  }}
                />
              ) : null}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="estimate-line-division">CSI division</Label>
                  <SearchableCombobox
                    id="estimate-line-division"
                    value={line.divisionCode}
                    onValueChange={(value) =>
                      setLine({
                        ...line,
                        divisionCode: value,
                        costCode: "",
                        reportPhaseId: "",
                      })
                    }
                    options={divisions.map(([value, label]) => ({
                      value,
                      label,
                      keywords: value,
                    }))}
                    ariaLabel="CSI division"
                    placeholder="Choose division first"
                    searchPlaceholder="Search divisions, e.g. 03 or Concrete..."
                    emptyMessage="No matching divisions."
                  />
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
                  <Label htmlFor="estimate-report-phase">
                    Customer-facing report phase
                  </Label>
                  <SearchableCombobox
                    id="estimate-report-phase"
                    value={line.reportPhaseId || "__csi__"}
                    onValueChange={(value) =>
                      setLine({
                        ...line,
                        reportPhaseId:
                          value === "__csi__" || value === "" ? "" : value,
                      })
                    }
                    options={[
                      { value: "__csi__", label: "Default CSI grouping" },
                      ...workspace.reportPhases
                        .filter(
                          (phase) => phase.divisionCode === line.divisionCode
                        )
                        .map((phase) => ({ value: phase.id, label: phase.name })),
                    ]}
                    ariaLabel="Customer-facing report phase"
                    placeholder="Default CSI grouping"
                    searchPlaceholder="Search report phases..."
                    emptyMessage="No matching report phases."
                    className="sm:max-w-sm"
                  />
                  <p className="text-xs text-muted-foreground">Create phases in Client report settings. CSI cost codes and calculations are unchanged.</p>
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
              {!lineUsesCostBreakdown && (
              <div
                className="mt-3 grid gap-2 border-y py-3 text-sm sm:grid-cols-4"
                aria-live="polite"
              >
                <div>
                  <p className="text-xs text-muted-foreground">Direct cost</p>
                  <p className="font-medium">
                    {money(linePreview.directCostCents)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Markup</p>
                  <p className="font-medium">{money(linePreview.markupCents)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Sales tax
                    {line.taxable && effectiveLineTaxEntity
                      ? ` · ${percent(effectiveLineTaxEntity.rateBasisPoints)}`
                      : ""}
                  </p>
                  <p className="font-medium">{money(linePreview.taxCents)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Line total</p>
                  <p className="font-semibold">
                    {money(linePreview.lineTotalCents)}
                  </p>
                </div>
                {line.taxable && !effectiveLineTaxEntity && (
                  <p className="text-xs text-destructive sm:col-span-4">
                    Choose a tax entity before saving this taxable line.
                  </p>
                )}
              </div>
            )}
              {pricing.view && (
                <EstimateLinePricedBy
                  sources={pricing.view.sources}
                  estimators={pricing.view.estimators}
                  value={line.pricingSource}
                  estimatorId={line.takeoffEstimatorId}
                  state={line.id ? pricing.view.lines[line.id] : undefined}
                  disabled={isPending}
                  onSourceChange={(source) =>
                    setLine({
                      ...line,
                      pricingSource: source?.id ?? "",
                      // Owner scope is the owner's number: no builder fee, no sales tax.
                      ...(source?.ownerScope ? { includeInBuilderFee: false, taxable: false, taxEntityId: "" } : {}),
                    })
                  }
                  onEstimatorChange={(takeoffEstimatorId) => setLine({ ...line, takeoffEstimatorId })}
                />
              )}
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
                  <Checkbox
                    checked={line.includeInBuilderFee}
                    onCheckedChange={(checked) =>
                      setLine({
                        ...line,
                        includeInBuilderFee: checked === true,
                      })
                    }
                  />
                  Include cost in builder-fee calculation
                </label>
                <div className="ml-auto flex gap-2">
                  {(line.id || insertAfterLineId || addToGroupKey !== null) && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        closeLineEditor()
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                  type="submit"
                  disabled={
                    isPending ||
                    !line.costCode ||
                    (!lineUsesCostBreakdown &&
                      line.taxable &&
                      !effectiveLineTaxEntity)
                  }
                >
                    <IconPlus className="size-4" />{" "}
                    {line.id
                      ? "Save line"
                      : insertAfterLineId
                        ? "Insert line"
                        : "Add line"}
                  </Button>
                </div>
              </div>
            </form>
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
              <p className="mt-1 text-lg font-semibold">{money(Number(value))}</p>
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

      {/* Keep every header field mounted: saving from any area submits the complete draft. */}
      <form
        className="clarity-panel-strong p-4"
        hidden={
          !["details", "signers", "contract", "text"].includes(workSection)
        }
        onSubmit={saveHeader}
        onInvalid={(event) => {
          event.preventDefault()
          const field = event.target
          if (
            !(
              field instanceof HTMLInputElement ||
              field instanceof HTMLTextAreaElement
            )
          )
            return
          const section = field
            .closest("[data-estimate-work-section]")
            ?.getAttribute("data-estimate-work-section")
          if (section && isEstimateWorkSection(section)) setWorkSection(section)
          setMessage(field.validationMessage)
          requestAnimationFrame(() => field.focus())
        }}
      >
        <p className="mb-4 text-xs text-muted-foreground">
          <span className="text-destructive" aria-hidden="true">*</span>{" "}
          Required before preparing the estimate for signature.
        </p>
        <div
          hidden={workSection !== "details"}
          data-estimate-work-section="details"
        >
          <h2 className="mb-4 font-semibold">Estimate details</h2>
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
          </div>
        </div>
        <div
          hidden={workSection !== "signers"}
          data-estimate-work-section="signers"
        >
          <h2 className="mb-4 font-semibold">Contract signers</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="border-t pt-4 md:col-span-2 xl:col-span-4">
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
                <Label>
                  Client / owner signers
                  <SignatureRequiredMark />
                </Label>
                {editable && clientSigners.length < 10 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setClientSigners([
                        ...clientSigners,
                        {
                          contactId: null,
                          name: "",
                          title: "",
                          email: "",
                          initials: "",
                        },
                      ])
                    }
                  >
                    <IconPlus className="size-4" />
                    Add signer
                  </Button>
                )}
              </div>
              {clientSigners.length === 0 && (
              <p className="text-xs text-muted-foreground">Add at least one client or owner signer.</p>
            )}
              {clientSigners.map((signer, index) => (
                <div
                  key={`${estimate.id}-client-signer-${index}`}
                  className="space-y-3 border-t pt-3"
                >
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
                      <Label htmlFor={`clientSignerInitials-${index}`}>
                        Reference initials
                      </Label>
                      <Input
                        id={`clientSignerInitials-${index}`}
                        maxLength={6}
                        value={signer.initials}
                        disabled={!editable}
                        onChange={(event) =>
                          setClientSigners(
                            clientSigners.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    initials: event.target.value.toUpperCase(),
                                  }
                                : item
                            )
                          )
                        }
                      />
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
          </div>
        </div>
        <div
          hidden={workSection !== "contract"}
          data-estimate-work-section="contract"
        >
          <h2 className="mb-4 font-semibold">Contract terms</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="termsTemplateId">Contract terms template</Label>
            <input type="hidden" name="termsTemplateId" value={termsTemplateId} />
            <SearchableCombobox
              id="termsTemplateId"
              value={termsTemplateId}
              onValueChange={(value) => {
                setTermsTemplateId(value)
                // A cleared or missing template keeps the text already written.
                if (value === "") return
                setContractTerms(
                  selectedTemplateBody(workspace.termsTemplates, value)
                )
              }}
              disabled={!editable}
              options={workspace.termsTemplates}
              ariaLabel="Contract terms template"
              placeholder="Choose a terms template"
              searchPlaceholder="Search templates..."
              emptyMessage="No matching templates."
            />
            {workspace.termsTemplates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No {workspace.department}-department terms templates are
                available yet. Enter estimate-specific terms below.
              </p>
            )}
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
          </div>
        </div>
        <div hidden={workSection !== "text"} data-estimate-work-section="text">
          <h2 className="mb-4 font-semibold">Introduction & closing</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="introductionTemplateId">
              Introductory text template
            </Label>
            <input type="hidden" name="introductionTemplateId" value={introductionTemplateId} />
            <SearchableCombobox
              id="introductionTemplateId"
              value={introductionTemplateId}
              onValueChange={(value) => {
                setIntroductionTemplateId(value)
                // A cleared or missing template keeps the text already written.
                if (value === "") return
                setIntroductionText(
                  selectedTemplateBody(workspace.introductionTemplates, value)
                )
              }}
              disabled={!editable || workspace.introductionTemplates.length === 0}
              options={workspace.introductionTemplates}
              ariaLabel="Introductory text template"
              placeholder="Choose introductory copy"
              searchPlaceholder="Search templates..."
              emptyMessage="No matching templates."
            />
          </div>
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="closingTemplateId">Closing text template</Label>
            <input type="hidden" name="closingTemplateId" value={closingTemplateId} />
            <SearchableCombobox
              id="closingTemplateId"
              value={closingTemplateId}
              onValueChange={(value) => {
                setClosingTemplateId(value)
                // A cleared or missing template keeps the text already written.
                if (value === "") return
                setClosingText(
                  selectedTemplateBody(workspace.closingTemplates, value)
                )
              }}
              disabled={!editable || workspace.closingTemplates.length === 0}
              options={workspace.closingTemplates}
              ariaLabel="Closing text template"
              placeholder="Choose closing copy"
              searchPlaceholder="Search templates..."
              emptyMessage="No matching templates."
            />
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
        workSection={workSection}
      />

      <section
        className="clarity-panel-strong p-4"
        hidden={workSection !== "costs" && workSection !== "fees"}
      >
        <div
          hidden={workSection !== "costs"}
          className="mb-4 flex flex-wrap items-start justify-between gap-3"
        >
          <div>
            <h2 className="font-semibold">{buildView === "assembly" ? "Assembly estimate" : "CSI estimate"}</h2>
            <p className="text-xs text-muted-foreground">
              {buildView === "assembly"
                ? "Build named assemblies using cost codes from any division. Each assembly subtotal updates from its items."
                : "Select a division first, then add the cost codes needed within it. Each division subtotal updates from its lines."}
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
              <ProjectEstimateBuildertrendImport
                projectId={projectId}
                estimateId={estimate.id}
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
        <div
          hidden={workSection !== "costs"}
          className="mb-4 flex flex-wrap items-end gap-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="estimate-build-view">Build by</Label>
            <SearchableCombobox
              id="estimate-build-view"
              className="w-full sm:w-56"
              ariaLabel="Build estimate by"
              placeholder="Choose build view"
              value={buildView}
              options={[
                { value: "division", label: "Division / cost code" },
                { value: "assembly", label: "Assembly" },
              ]}
              onValueChange={(value) => {
                if (value === "division" || value === "assembly")
                  setBuildView(value)
              }}
            />
          </div>
          {editable && (
            <ProjectEstimateAssemblyEditor projectId={projectId} estimateId={estimate.id} assembly={null} assemblies={workspace.assemblies} lines={workspace.lines} />
          )}
          {workspace.canEdit && (
            <EstimateCopyToProjectButton projectId={projectId} estimateId={estimate.id} groups={copyGroups} unassignedCount={unassignedLineCount} />
          )}
          <p className="text-xs text-muted-foreground">Both views edit the same estimate. Choose the report format separately.</p>
        </div>
        <p
          hidden={workSection !== "fees"}
          className="mb-4 text-xs text-muted-foreground"
        >
          Overhead, margin, and contingency are builder-fee percentages applied
          to eligible estimate items. They remain separate from Sage cost-code
          lines until their accounting mappings are assigned.
        </p>
        <div
          hidden={workSection !== "fees"}
          className="mb-5 grid gap-4 border-y py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        >
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
        <div hidden={workSection !== "costs"}>
          {groupedLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No estimate lines yet.
            </p>
          ) : (
            <div className="space-y-4">
              {groupedLines.map((group) => {
                const { items } = group
                const subtotal = items.reduce(
                (sum, item) => sum + item.lineTotalCents,
                0
              )
                return (
                  <div key={group.key} className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-y bg-estimate-section px-3 py-3">
                      <div className="min-w-0 flex-1 break-words">
                        <h3 className="break-words text-sm font-semibold">
                        {group.name}
                      </h3>
                        <p className="text-xs text-muted-foreground">
                          {items.length} cost-code{" "}
                          {items.length === 1 ? "line" : "lines"}
                          {group.description && ` · ${group.description}`}
                        </p>
                        {buildView === "assembly" && (
                          <EstimateAssemblyCopyNotes copies={assemblyCopies} assemblyId={group.assemblyId ?? null} />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <p className="font-semibold">
                          <span className="text-xs font-normal text-muted-foreground">
                            Subtotal{" "}
                          </span>
                          {money(subtotal)}
                        </p>
                        {workspace.canEdit && buildView === "assembly" && group.assemblyId && !estimate.changeOrderId && !estimate.phaseProposalId && (
                          <EstimatePhaseExportButton
                            projectId={projectId}
                            estimateId={estimate.id}
                            assemblyId={group.assemblyId}
                            assemblyName={workspace.assemblies.find((assembly) => assembly.id === group.assemblyId)?.name ?? "Assembly"}
                          />
                        )}
                        {workspace.canEdit && buildView === "assembly" && group.assemblyId && (
                          <EstimateCopyToProjectButton
                            projectId={projectId}
                            estimateId={estimate.id}
                            groups={copyGroups}
                            unassignedCount={unassignedLineCount}
                            preselectedAssemblyId={group.assemblyId}
                          />
                        )}
                        {editable && buildView === "assembly" && (
                          <>
                            {group.assemblyId && (
                              <ProjectEstimateAssemblyEditor projectId={projectId} estimateId={estimate.id} assembly={workspace.assemblies.find((assembly) => assembly.id === group.assemblyId) ?? null} assemblies={workspace.assemblies} lines={workspace.lines} />
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                openLineEditor(
                                  {
                                    ...EMPTY_LINE,
                                    assemblyId: group.assemblyId,
                                  },
                                  null,
                                  group.key
                                )
                              }
                            >
                              Add item
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <ProjectEstimateLineOrder
                      projectId={projectId}
                      estimateId={estimate.id}
                      updatedAt={estimate.updatedAt}
                      group={buildView === "assembly"
                        ? { type: "assembly", assemblyId: group.assemblyId }
                        : { type: "division", divisionCode: group.key }}
                      groupName={group.name}
                      items={items}
                      editable={editable && !isPending}
                      renderItem={(item) => (
                        <div className="py-3 pl-3 pr-3">
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
                              {item.reportPhaseId && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Report phase:{" "}
                                  {workspace.reportPhases.find((phase) => phase.id === item.reportPhaseId)?.name ?? "Default CSI grouping"}
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
                              <EstimateLinePricingBadge sources={pricing.view?.sources ?? []} state={pricing.view?.lines[item.id]} lineTotalCents={item.lineTotalCents} />
                              <p className="text-xs text-muted-foreground">
                              {item.costItems.length > 0
                                ? `${item.costItems.length} cost-code breakdown · direct ${money(item.directCostCents)} · markup ${money(item.markupCents)} · tax ${money(item.taxCents)}`
                                : `${item.quantity} ${item.unit} × ${money(item.unitCostCents)} · markup ${percent(item.markupRateBasisPoints)}${item.taxable ? ` · ${item.taxCode ?? "tax"} ${percent(item.taxRateBasisPoints)}` : " · non-taxable"}`}
                            </p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="font-medium">{money(item.lineTotalCents)}</span>
                            {editable && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openLineEditor({ ...lineDraft(item), pricingSource: pricing.view?.lines[item.id]?.pricingSource ?? "" })}
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
                                        assemblyId: item.assemblyId,
                                        reportPhaseId: item.reportPhaseId ?? "",
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
                          {editable && (line.id === item.id || (!line.id && insertAfterLineId === item.id)) && (
                            <div className="mt-3">{renderLineEditor("inline")}</div>
                          )}
                        </div>
                      )}
                    />
                    {editable && !line.id && !insertAfterLineId && addToGroupKey === group.key && (
                      <div className="px-3 py-3">{renderLineEditor("inline")}</div>
                    )}
                  </div>
                )
              })}
              <div className="ml-auto max-w-sm space-y-2 border-t bg-estimate-subtotal p-3 text-sm">
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

          {editable && !editorIsInline && renderLineEditor("bottom")}
        </div>
      </section>

      <section
        className="clarity-panel-strong p-4"
        hidden={workSection !== "basis"}
      >
        <h2 className="font-semibold">
          Plans, specifications, and estimate basis
        </h2>
        <div className="mt-3 divide-y">
          {workspace.basisDocuments.map((document) => (
            <div
              key={document.id}
              className="flex items-start justify-between gap-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{document.title}</p>
                <p className="text-xs text-muted-foreground">
                  {statusLabel(document.documentType)} ·{" "}
                  {document.documentDate ?? "date not set"}
                  {document.revision ? ` · revision ${document.revision}` : ""}
                </p>
                {document.projectDocumentId && (
                  <p className="mt-1 text-xs font-medium text-primary">
                    Linked to the published project document
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {document.driveUrl && (
                  <Button variant="outline" size="sm" asChild><Link href={document.driveUrl} target="_blank">Open</Link></Button>
                )}
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
            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
              <Label htmlFor="estimate-basis-project-document">Published project plan or specification</Label>
              <SearchableCombobox
                id="estimate-basis-project-document"
                ariaLabel="Published project document used as estimate basis"
                placeholder="Choose a published document, or enter a legacy reference below"
                searchPlaceholder="Search published plans and specifications..."
                emptyMessage="No published project documents match."
                options={workspace.projectDocumentOptions.map((document) => ({
                  value: document.id,
                  label: document.title,
                  selectedLabel: document.title,
                  description: `${statusLabel(document.category)}${document.revision ? ` · revision ${document.revision}` : ""} · ${document.status}`,
                }))}
                value={basisProjectDocumentId}
                onValueChange={setBasisProjectDocumentId}
              />
              {basisProjectDocumentId && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setBasisProjectDocumentId("")}>
                  Use a legacy/manual reference instead
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                This links the exact published revision to the estimate. A later contract packet inherits that estimate basis without changing when newer plans are published.
              </p>
            </div>
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
            <div className="space-y-1.5 xl:col-span-2"><Label htmlFor="documentTitle">Legacy/manual title</Label><Input id="documentTitle" name="documentTitle" required={!basisProjectDocumentId} disabled={Boolean(basisProjectDocumentId)} /></div>
            <div className="space-y-1.5"><Label htmlFor="basisDate">Document date</Label><Input id="basisDate" name="documentDate" type="date" /></div>
            <div className="space-y-1.5"><Label htmlFor="basisRevision">Revision</Label><Input id="basisRevision" name="revision" /></div>
            <div className="space-y-1.5 xl:col-span-2"><Label htmlFor="basisDriveUrl">Legacy/manual Google Drive link</Label><Input id="basisDriveUrl" name="driveUrl" type="url" disabled={Boolean(basisProjectDocumentId)} /></div>
            <div className="flex items-end"><Button type="submit" disabled={isPending}><IconPlus className="size-4" />Add basis</Button></div>
          </form>
        )}
      </section>

      <section
        className="clarity-panel-strong p-4"
        hidden={workSection !== "approval"}
      >
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
                Contract terms are required. Add and save them under Contract
                terms &amp; acknowledgements before preparing the final
                signature package.
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
                {estimate.foxitStatus === "completed" && (
                  <div>
                    <h3 className="text-sm font-semibold">Signed in Foxit</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Every signer completed this version. Because it changes the accepted contract, record the
                      acceptance below and choose whether it replaces the contract or becomes a change order.
                    </p>
                  </div>
                )}
                {estimate.foxitStatus !== "not_applicable" && estimate.foxitStatus !== "completed" && (
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
                      <Select name="acceptanceMethod">
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
                      {estimate.foxitStatus === "completed" && (
                        <p className="text-xs text-muted-foreground">Leave blank to use the Foxit-signed copy.</p>
                      )}
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
                  <EstimateVersionAcceptanceFields
                    projectId={projectId}
                    estimateId={estimate.id}
                    onReplacesContractChange={setAcceptanceChangesContract}
                  />
                  <div className="flex items-start gap-2 border-t pt-3">
                    <Checkbox id="manualAcceptanceAttestation" checked={manualAcceptanceAttested} onCheckedChange={(checked) => setManualAcceptanceAttested(checked === true)} />
                    <Label htmlFor="manualAcceptanceAttestation" className="max-w-3xl text-sm font-normal leading-5">
                      I confirm this document contains the required client and
                      company representative signatures and matches this locked
                      estimate version.
                    </Label>
                  </div>
                  <Button type="submit" variant="outline" disabled={isPending || !manualAcceptanceAttested}>
                    <IconUpload className="size-4" />
                    {acceptanceChangesContract
                      ? "Record acceptance and create the change order"
                      : "Record executed contract and create Budget/G703"}
                  </Button>
                </form>
              </div>
            )}
            {estimate.status === "accepted" && (
              <div className="mt-4 border-t pt-4 text-sm">
                <p className="font-medium text-success">
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
