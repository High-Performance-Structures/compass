"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition, type FormEvent } from "react"
import {
  IconCopy,
  IconFileDescription,
  IconPlus,
  IconPrinter,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  addProjectContractPacketDocument,
  createProjectContractPacket,
  deleteProjectContractPacket,
  deleteProjectContractPacketDocument,
  duplicateProjectContractPacket,
  markProjectContractPacketSentOutsideCompass,
  prepareProjectContractPacketForSignature,
  recordManualProjectContractPacketExecution,
  saveProjectContractPacket,
  saveProjectContractPacketDocument,
  type ProjectContractPacketDocumentItem,
  type ProjectContractPacketWorkspace,
} from "@/app/actions/contract-packets"
import { uploadEstimateAcceptanceEvidence } from "@/components/projects/project-estimate-acceptance-upload"
import { ProjectEstimateSignerPicker } from "@/components/projects/project-estimate-signer-picker"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
import {
  contractDepositCents,
  contractPacketCanBeEdited,
  signerInitials,
  type ContractPacketSigner,
} from "@/lib/contracts/packet"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ")
}

function localDateInput(): string {
  const now = new Date()
  const local = new Date(now.valueOf() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function ContractDocumentEditor({
  projectId,
  packetId,
  document,
  editable,
}: {
  readonly projectId: string
  readonly packetId: string
  readonly document: ProjectContractPacketDocumentItem
  readonly editable: boolean
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(document.title)
  const [content, setContent] = useState(document.contentMarkdown)
  const [inclusionMode, setInclusionMode] = useState(document.inclusionMode)
  const [signingStage, setSigningStage] = useState(document.signingStage)
  const [documentDate, setDocumentDate] = useState(document.documentDate ?? "")
  const [revision, setRevision] = useState(document.revision ?? "")

  function save(): void {
    startTransition(async () => {
      const result = await saveProjectContractPacketDocument(
        projectId,
        packetId,
        document.id,
        {
          title,
          contentMarkdown: content,
          inclusionMode,
          signingStage,
          documentDate,
          revision,
        }
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function remove(): void {
    startTransition(async () => {
      const result = await deleteProjectContractPacketDocument(
        projectId,
        packetId,
        document.id
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  return (
    <article className="border-b py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{document.code}</span>
            <span>{document.title}</span>
            <Badge variant="outline">{statusLabel(document.inclusionMode)}</Badge>
            <Badge variant="secondary">{statusLabel(document.signingStage)}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {document.revision ?? "Packet snapshot"}
            {document.signingStage === "closeout"
              ? " · retained for the final walk-through, not the initial signing envelope"
              : ""}
          </p>
        </div>
        {document.sourceUrl && (
          <Button asChild size="sm" variant="outline">
            <Link href={document.sourceUrl} target="_blank">Source</Link>
          </Button>
        )}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">
          Review packet copy
        </summary>
        <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor={`packet-document-title-${document.id}`}>Document title *</Label>
            <Input
              id={`packet-document-title-${document.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!editable}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Packet treatment *</Label>
            <Select value={inclusionMode} onValueChange={setInclusionMode} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="embedded">Include in packet</SelectItem>
                <SelectItem value="reference">Reference only</SelectItem>
                <SelectItem value="generated">Generate from Compass</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lifecycle stage *</Label>
            <Select value={signingStage} onValueChange={setSigningStage} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contract">Initial contract execution</SelectItem>
                <SelectItem value="construction">During construction</SelectItem>
                <SelectItem value="closeout">Closeout / walk-through</SelectItem>
                <SelectItem value="reference">Reference only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`packet-document-date-${document.id}`}>Document date</Label>
            <Input
              id={`packet-document-date-${document.id}`}
              type="date"
              value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
            <Label htmlFor={`packet-document-revision-${document.id}`}>Revision</Label>
            <Input
              id={`packet-document-revision-${document.id}`}
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
              disabled={!editable}
            />
          </div>
          {inclusionMode !== "generated" && (
            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
              <Label htmlFor={`packet-document-content-${document.id}`}>Packet-specific document text *</Label>
              <Textarea
                id={`packet-document-content-${document.id}`}
                rows={16}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                disabled={!editable || inclusionMode === "reference"}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                This is a project snapshot. Editing it does not change the published library template.
              </p>
            </div>
          )}
        </div>
        {editable && (
          <div className="mt-4 flex justify-end gap-2 border-t pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="text-destructive" disabled={pending}>
                  <IconTrash className="size-4" />Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {document.code}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It will be omitted from this packet and from CA00&apos;s generated document schedule. The published library copy is unchanged.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>Remove document</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button onClick={save} disabled={pending}>Save document snapshot</Button>
          </div>
        )}
      </details>
    </article>
  )
}

export function ProjectContractPacketWorkspacePanel({
  projectId,
  workspace,
}: {
  readonly projectId: string
  readonly workspace: ProjectContractPacketWorkspace
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [estimateId, setEstimateId] = useState(workspace.estimateOptions[0]?.id ?? "")
  const packet = workspace.activePacket
  const editable = Boolean(packet && workspace.canEdit && contractPacketCanBeEdited(packet.status))
  const linkedEstimate = workspace.estimateOptions.find(
    (estimate) => estimate.id === packet?.estimateId
  )
  const initialDepositRateBasisPoints = packet?.depositRateBasisPoints || (
    packet && linkedEstimate && linkedEstimate.estimateTotalCents > 0
      ? Math.round(packet.depositCents * 10_000 / linkedEstimate.estimateTotalCents)
      : 0
  )
  const [title, setTitle] = useState(packet?.title ?? "Construction Contract")
  const [legalEntityName, setLegalEntityName] = useState(packet?.legalEntityName ?? "")
  const [contractDraftDate, setContractDraftDate] = useState(packet?.contractDraftDate ?? "")
  const [commencementDate, setCommencementDate] = useState(packet?.approximateCommencementDate ?? "")
  const [completionDate, setCompletionDate] = useState(packet?.approximateCompletionDate ?? "")
  const [depositPercent, setDepositPercent] = useState(
    initialDepositRateBasisPoints > 0
      ? String(initialDepositRateBasisPoints / 100)
      : ""
  )
  const [latePaymentRate, setLatePaymentRate] = useState(packet ? String(packet.latePaymentRateBasisPoints / 100) : "12")
  const [projectAddress, setProjectAddress] = useState(packet?.details.projectAddress ?? workspace.projectAddress ?? "")
  const [county, setCounty] = useState(packet?.details.county ?? "")
  const [ownerName, setOwnerName] = useState(packet?.details.ownerName ?? "")
  const [clientSigners, setClientSigners] = useState<readonly ContractPacketSigner[]>(packet?.clientSigners ?? [])
  const [companySigner, setCompanySigner] = useState<ContractPacketSigner>({
    contactId: null,
    name: packet?.companySignerName ?? "",
    title: packet?.companySignerTitle ?? "",
    email: packet?.companySignerEmail ?? "",
    initials: packet?.companySignerInitials ?? "",
  })
  const missingTemplates = useMemo(
    () => workspace.templateOptions.filter(
      (template) => !workspace.documents.some((document) => document.templateId === template.id)
    ),
    [workspace.documents, workspace.templateOptions]
  )
  const [templateId, setTemplateId] = useState(missingTemplates[0]?.id ?? "")
  const [evidenceUrl, setEvidenceUrl] = useState("")
  const [evidenceLabel, setEvidenceLabel] = useState("")
  const [signedAt, setSignedAt] = useState(localDateInput())
  const [attested, setAttested] = useState(false)
  const parsedDepositPercent = Number(depositPercent)
  const depositRateBasisPoints = Number.isFinite(parsedDepositPercent)
    ? Math.round(parsedDepositPercent * 100)
    : 0
  const calculatedDepositCents = linkedEstimate
    ? contractDepositCents(linkedEstimate.estimateTotalCents, depositRateBasisPoints)
    : 0

  function create(): void {
    if (!estimateId) return
    startTransition(async () => {
      const result = await createProjectContractPacket(projectId, estimateId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.push(`/dashboard/projects/${projectId}/contracts?packetId=${result.id}`)
      router.refresh()
    })
  }

  async function saveCurrentContractInformation(
    showSuccessMessage: boolean
  ): Promise<boolean> {
    if (!packet) return false
    const result = await saveProjectContractPacket(projectId, packet.id, {
      title,
      legalEntityName,
      contractDraftDate,
      approximateCommencementDate: commencementDate,
      approximateCompletionDate: completionDate,
      depositPercent: parsedDepositPercent,
      latePaymentPercent: Number(latePaymentRate),
      details: {
        ...packet.details,
        projectName: workspace.projectName,
        projectNumber: workspace.projectNumber ?? "",
        projectAddress,
        ownerName,
        county,
      },
      clientSigners,
      companySignerName: companySigner.name,
      companySignerTitle: companySigner.title,
      companySignerEmail: companySigner.email,
      companySignerInitials: companySigner.initials || signerInitials(companySigner.name),
    })
    if (!result.success) {
      toast.error(result.error)
      return false
    }
    if (showSuccessMessage) {
      toast.success(result.message)
    }
    return true
  }

  function save(): void {
    startTransition(async () => {
      if (await saveCurrentContractInformation(true)) router.refresh()
    })
  }

  function preview(): void {
    if (!packet) return
    const previewWindow = window.open("about:blank", "_blank")
    if (previewWindow) {
      previewWindow.opener = null
      previewWindow.document.title = "Preparing contract packet preview"
      previewWindow.document.body.textContent =
        "Compass is saving the contract information and preparing the preview..."
    }
    startTransition(async () => {
      if (editable && !(await saveCurrentContractInformation(false))) {
        previewWindow?.close()
        return
      }
      const previewUrl = `/print/projects/${projectId}/contract-packet?packetId=${packet.id}`
      if (previewWindow) {
        previewWindow.location.replace(previewUrl)
      } else {
        window.location.href = previewUrl
      }
      router.refresh()
    })
  }

  function addSigner(): void {
    setClientSigners([
      ...clientSigners,
      { contactId: null, name: "", title: "", email: "", initials: "" },
    ])
  }

  function updateSigner(index: number, value: ContractPacketSigner): void {
    setClientSigners(clientSigners.map((signer, signerIndex) =>
      signerIndex === index ? value : signer
    ))
  }

  function duplicate(): void {
    if (!packet) return
    startTransition(async () => {
      const result = await duplicateProjectContractPacket(projectId, packet.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.push(`/dashboard/projects/${projectId}/contracts?packetId=${result.id}`)
      router.refresh()
    })
  }

  function addDocument(): void {
    if (!packet || !templateId) return
    startTransition(async () => {
      const result = await addProjectContractPacketDocument(projectId, packet.id, templateId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function deletePacket(): void {
    if (!packet) return
    startTransition(async () => {
      const result = await deleteProjectContractPacket(projectId, packet.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.push(`/dashboard/projects/${projectId}/contracts`)
      router.refresh()
    })
  }

  function prepareForSignature(): void {
    if (!packet) return
    const foxitWindow = window.open("about:blank", "_blank")
    if (foxitWindow) {
      foxitWindow.opener = null
      foxitWindow.document.title = "Preparing Foxit contract packet"
      foxitWindow.document.body.textContent =
        "Compass is assembling the numbered contract packet and Foxit fields..."
    }
    startTransition(async () => {
      if (editable && !(await saveCurrentContractInformation(false))) {
        foxitWindow?.close()
        return
      }
      const result = await prepareProjectContractPacketForSignature(
        projectId,
        packet.id
      )
      if (!result.success) {
        foxitWindow?.close()
        toast.error(result.error)
        return
      }
      if (foxitWindow) {
        foxitWindow.location.replace(result.embeddedSessionUrl)
      } else {
        window.open(result.embeddedSessionUrl, "_blank", "noopener,noreferrer")
      }
      router.refresh()
    })
  }

  function markOutside(): void {
    if (!packet) return
    startTransition(async () => {
      const result = await markProjectContractPacketSentOutsideCompass(
        projectId,
        packet.id
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  async function uploadEvidence(file: File): Promise<void> {
    try {
      const uploaded = await uploadEstimateAcceptanceEvidence(file, projectId)
      setEvidenceUrl(uploaded.url)
      setEvidenceLabel(uploaded.label)
      toast.success("Signed packet uploaded to the project Drive folder.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload signed packet.")
    }
  }

  function recordManualExecution(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!packet) return
    startTransition(async () => {
      const result = await recordManualProjectContractPacketExecution(
        projectId,
        packet.id,
        { signedAt, evidenceUrl, evidenceLabel, attested }
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  if (!packet) {
    return (
      <section className="clarity-panel-strong p-5">
        <h2 className="font-semibold">Create a full construction contract packet</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Choose the exact estimate that will become CA22. Compass will copy the current published contract documents into an independent, editable project packet.
        </p>
        <div className="mt-4 flex max-w-3xl flex-col gap-3 sm:flex-row">
          <SearchableCombobox
            ariaLabel="Choose estimate for contract"
            placeholder="Choose an estimate"
            searchPlaceholder="Search estimate versions..."
            value={estimateId}
            onValueChange={setEstimateId}
            options={workspace.estimateOptions.map((estimate) => ({
              value: estimate.id,
              label: `${estimate.estimateNumber} · v${estimate.versionNumber} · ${estimate.title}`,
              description: `${statusLabel(estimate.status)} · ${money(estimate.estimateTotalCents)}`,
            }))}
          />
          <Button onClick={create} disabled={pending || !estimateId || !workspace.canEdit}>
            <IconPlus className="size-4" />Create contract packet
          </Button>
        </div>
        {workspace.templateOptions.length === 0 && (
          <p className="mt-4 text-sm text-destructive">
            The Contract Library has not been imported and published yet. Open Templates in Settings first.
          </p>
        )}
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <section className="clarity-panel-strong p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <IconFileDescription className="size-5 text-primary" />
              <h2 className="font-semibold">{packet.packetNumber} · contract packet v{packet.versionNumber}</h2>
              <Badge variant="outline">{statusLabel(packet.status)}</Badge>
              <Badge variant="secondary">Foxit {statusLabel(packet.foxitStatus)}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Linked to estimate version {workspace.estimateOptions.find((estimate) => estimate.id === packet.estimateId)?.versionNumber ?? "—"}. Sent packets are frozen; duplicate one to revise it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={packet.id}
              onValueChange={(value) => router.push(`/dashboard/projects/${projectId}/contracts?packetId=${value}`)}
            >
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {workspace.packets.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.packetNumber} · v{item.versionNumber} · {statusLabel(item.status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={duplicate} disabled={pending || !workspace.canEdit}>
              <IconCopy className="size-4" />Duplicate version
            </Button>
            <Button variant="outline" onClick={preview} disabled={pending}>
              <IconPrinter className="size-4" />Preview PDF
            </Button>
          </div>
        </div>
      </section>

      <section className="clarity-panel-strong p-4">
        <h2 className="font-semibold">Contract information</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Asterisks identify information required before the initial contract can be sent for signature.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="contract-title">Packet title *</Label><Input id="contract-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!editable} /></div>
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="contract-entity">Contractor legal entity *</Label><Input id="contract-entity" value={legalEntityName} onChange={(event) => setLegalEntityName(event.target.value)} disabled={!editable} /></div>
          <div className="space-y-1.5"><Label htmlFor="contract-date">Contract date *</Label><Input id="contract-date" type="date" value={contractDraftDate} onChange={(event) => setContractDraftDate(event.target.value)} disabled={!editable} /></div>
          <div className="space-y-1.5"><Label htmlFor="contract-start">Approximate commencement *</Label><Input id="contract-start" type="date" value={commencementDate} onChange={(event) => setCommencementDate(event.target.value)} disabled={!editable} /></div>
          <div className="space-y-1.5"><Label htmlFor="contract-completion">Approximate completion *</Label><Input id="contract-completion" type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} disabled={!editable} /></div>
          <div className="space-y-1.5"><Label htmlFor="contract-county">Project county *</Label><Input id="contract-county" value={county} onChange={(event) => setCounty(event.target.value)} disabled={!editable} /></div>
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="contract-address">Project location *</Label><Input id="contract-address" value={projectAddress} onChange={(event) => setProjectAddress(event.target.value)} disabled={!editable} /></div>
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="contract-owner">Owner / client name *</Label><Input id="contract-owner" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} disabled={!editable} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="contract-deposit-percent">Deposit (% of estimate) *</Label>
            <Input
              id="contract-deposit-percent"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={depositPercent}
              onChange={(event) => setDepositPercent(event.target.value)}
              disabled={!editable}
              required
            />
            <p className="text-xs text-muted-foreground">
              {linkedEstimate
                ? `${money(calculatedDepositCents)} deposit from ${money(linkedEstimate.estimateTotalCents)} estimate total.`
                : "The linked estimate total is unavailable."}
            </p>
          </div>
          <div className="space-y-1.5"><Label htmlFor="contract-late-rate">Late-payment annual rate (%)</Label><Input id="contract-late-rate" type="number" min="0" step="0.01" value={latePaymentRate} onChange={(event) => setLatePaymentRate(event.target.value)} disabled={!editable} /></div>
        </div>
      </section>

      <section className="clarity-panel-strong p-4">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-semibold">Required signers</h2><p className="mt-1 text-sm text-muted-foreground">Every signer receives Foxit signature, date-signed, and page-initial fields.</p></div>
          {editable && <Button variant="outline" size="sm" onClick={addSigner}><IconPlus className="size-4" />Add owner signer</Button>}
        </div>
        <div className="mt-4 space-y-4">
          {clientSigners.map((signer, index) => (
            <div key={`${index}-${signer.contactId ?? "typed"}`} className="grid gap-3 border-b pb-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1.5 xl:col-span-2">
                <Label>Owner signer {index + 1} *</Label>
                <ProjectEstimateSignerPicker
                  value={signer}
                  options={workspace.signerContacts}
                  onValueChange={(value) => updateSigner(index, { ...value, initials: signer.initials || signerInitials(value.name) })}
                  placeholder="Choose or type signer"
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={signer.email} onChange={(event) => updateSigner(index, { ...signer, email: event.target.value })} disabled={!editable} /></div>
              <div className="space-y-1.5"><Label>Title</Label><Input value={signer.title} onChange={(event) => updateSigner(index, { ...signer, title: event.target.value })} disabled={!editable} /></div>
              <div className="flex items-end gap-2"><div className="flex-1 space-y-1.5"><Label>Initials *</Label><Input value={signer.initials} maxLength={6} onChange={(event) => updateSigner(index, { ...signer, initials: event.target.value.toUpperCase() })} disabled={!editable} /></div>{editable && <Button variant="ghost" size="icon" className="text-destructive" aria-label={`Remove owner signer ${index + 1}`} onClick={() => setClientSigners(clientSigners.filter((_, signerIndex) => signerIndex !== index))}><IconTrash className="size-4" /></Button>}</div>
            </div>
          ))}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5 xl:col-span-2"><Label>Company representative *</Label><ProjectEstimateSignerPicker value={companySigner} options={workspace.signerContacts} onValueChange={(value) => setCompanySigner({ ...value, initials: companySigner.initials || signerInitials(value.name) })} placeholder="Choose or type company signer" disabled={!editable} /></div>
            <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={companySigner.email} onChange={(event) => setCompanySigner({ ...companySigner, email: event.target.value })} disabled={!editable} /></div>
            <div className="space-y-1.5"><Label>Title *</Label><Input value={companySigner.title} onChange={(event) => setCompanySigner({ ...companySigner, title: event.target.value })} disabled={!editable} /></div>
            <div className="space-y-1.5"><Label>Initials *</Label><Input value={companySigner.initials} maxLength={6} onChange={(event) => setCompanySigner({ ...companySigner, initials: event.target.value.toUpperCase() })} disabled={!editable} /></div>
          </div>
        </div>
        {editable && <div className="mt-4 flex justify-end border-t pt-4"><Button onClick={save} disabled={pending}>Save contract information</Button></div>}
      </section>

      <section className="clarity-panel-strong p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">Contract documents</h2><p className="mt-1 text-sm text-muted-foreground">CA00&apos;s document list is generated from these exact packet snapshots. The Warranty Handbook remains a separate reference.</p></div>
          {editable && missingTemplates.length > 0 && (
            <div className="flex min-w-[320px] gap-2">
              <SearchableCombobox ariaLabel="Add contract document" placeholder="Choose document" value={templateId} onValueChange={setTemplateId} options={missingTemplates.map((template) => ({ value: template.id, label: `${template.code} · ${template.name}`, description: `${statusLabel(template.signingStage)} · template v${template.versionNumber}` }))} />
              <Button variant="outline" onClick={addDocument} disabled={pending || !templateId}><IconPlus className="size-4" />Add</Button>
            </div>
          )}
        </div>
        <div className="mt-3">
          {workspace.documents.map((document) => <ContractDocumentEditor key={document.id} projectId={projectId} packetId={packet.id} document={document} editable={editable} />)}
        </div>
      </section>

      <section className="clarity-panel-strong p-4">
        <h2 className="font-semibold">Prepare and execute</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Review the combined PDF first. Preparing opens Foxit for final field review; sending freezes this version. It locks as executed only after all signers finish, or when a complete manually signed copy is recorded.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={prepareForSignature} disabled={pending || !editable}>Prepare full contract packet for signature</Button>
          <Button variant="outline" onClick={markOutside} disabled={pending || !editable}>Printed / sent for signatures outside Compass</Button>
          {packet.foxitEmbeddedSessionUrl && <Button variant="outline" asChild><Link href={packet.foxitEmbeddedSessionUrl} target="_blank">Review and send in Foxit</Link></Button>}
          {packet.signaturePackageUrl && <Button variant="outline" asChild><Link href={packet.signaturePackageUrl} target="_blank">Open signed packet</Link></Button>}
        </div>
        {packet.status === "signature_pending" && workspace.canEdit && (
          <form className="mt-5 space-y-4 border-t pt-4" onSubmit={recordManualExecution}>
            <div>
              <h3 className="text-sm font-semibold">Complete a manually signed packet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload the complete scanned packet to the project&apos;s Google Drive folder or paste its saved HTTPS link. Recording it executes and locks both the packet and its linked estimate.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="packet-signed-date">Contract execution date *</Label>
                <Input id="packet-signed-date" type="date" max={localDateInput()} value={signedAt} onChange={(event) => setSignedAt(event.target.value)} required />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="packet-evidence-url">Saved signed packet link *</Label>
                <Input id="packet-evidence-url" type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://drive.google.com/..." required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="packet-evidence-label">Document label *</Label>
                <Input id="packet-evidence-label" value={evidenceLabel} onChange={(event) => setEvidenceLabel(event.target.value)} placeholder="Executed contract.pdf" required />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="packet-evidence-file">Or upload the complete signed packet</Label>
                <Input
                  id="packet-evidence-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void uploadEvidence(file)
                  }}
                  disabled={pending}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={attested} onCheckedChange={(checked) => setAttested(checked === true)} />
              <span>I confirm the uploaded or linked packet is complete and contains every required owner and company representative signature. *</span>
            </label>
            <Button type="submit" disabled={pending || !attested}>Record execution and lock packet</Button>
          </form>
        )}
        {editable && (
          <div className="mt-5 border-t pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="ghost" className="text-destructive" disabled={pending}><IconTrash className="size-4" />Delete draft packet</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Delete this draft contract packet?</AlertDialogTitle><AlertDialogDescription>This removes only this unsent project packet and its document snapshots. The estimate and published Contract Library are unchanged.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={deletePacket}>Delete draft</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </section>
    </div>
  )
}
