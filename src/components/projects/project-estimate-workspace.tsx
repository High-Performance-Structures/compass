"use client"

import { useMemo, useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconFileDescription,
  IconFileExport,
  IconPlus,
  IconReceiptTax,
  IconSend,
  IconTrash,
} from "@tabler/icons-react"

import {
  addProjectEstimateBasisDocument,
  createProjectEstimateDraft,
  deleteProjectEstimateLine,
  prepareProjectEstimateForFoxit,
  recordSignedProjectEstimate,
  saveProjectEstimateLine,
  updateProjectEstimateHeader,
  type ProjectEstimateLineItem,
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

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`
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
  }
}

export function ProjectEstimateWorkspacePanel({
  projectId,
  workspace,
}: {
  readonly projectId: string
  readonly workspace: ProjectEstimateWorkspace
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [line, setLine] = useState<LineDraft>(EMPTY_LINE)
  const estimate = workspace.activeEstimate
  const editable =
    workspace.canEdit &&
    Boolean(estimate && ["draft", "internal_review"].includes(estimate.status))

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
        sourceWorkbookUrl: formText(formData, "sourceWorkbookUrl"),
        defaultTaxEntityId: formText(formData, "defaultTaxEntityId"),
        termsTemplateId: formText(formData, "termsTemplateId"),
        contractTerms: formText(formData, "contractTerms"),
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
        }
      )
      if (result.success) setLine(EMPTY_LINE)
      finish(result.success ? "Estimate line saved." : result.error)
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

  function prepareFoxit(): void {
    if (!estimate) return
    setMessage(null)
    startTransition(async () => {
      const result = await prepareProjectEstimateForFoxit(projectId, estimate.id)
      finish(
        result.success
          ? "CA22 estimate locked and ready for Foxit signature handoff."
          : result.error
      )
    })
  }

  function acceptSigned(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!estimate) return
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await recordSignedProjectEstimate(projectId, estimate.id, {
        signedDocumentUrl: formText(formData, "signedDocumentUrl"),
        foxitEnvelopeId: formText(formData, "foxitEnvelopeId"),
      })
      finish(
        result.success
          ? "Signed estimate accepted and contract budget created."
          : result.error
      )
    })
  }

  if (!estimate) {
    return (
      <section className="clarity-panel-strong p-6">
        <h2 className="text-lg font-semibold">Start the project estimate</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Build the CA22 estimate by CSI division and Sage cost code. Acceptance
          creates the original contract budget; later changes must come through
          executed change orders.
        </p>
        {workspace.canEdit && (
          <Button className="mt-4" onClick={createEstimate} disabled={isPending}>
            <IconPlus className="size-4" />
            Create estimate
          </Button>
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
              {estimate.estimateNumber} · Foxit {statusLabel(estimate.foxitStatus)} ·
              Sage {statusLabel(estimate.sageStatus)}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link
              href={`/print/projects/${projectId}/estimate?estimateId=${estimate.id}`}
              target="_blank"
            >
              <IconFileExport className="size-4" />
              CA22 preview
            </Link>
          </Button>
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
            <Label htmlFor="estimateDate">Estimate date</Label>
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
            <Select
              name="defaultTaxEntityId"
              defaultValue={estimate.defaultTaxEntityId ?? undefined}
              disabled={!editable}
            >
              <SelectTrigger id="defaultTaxEntityId">
                <SelectValue placeholder="Select a Sage tax entity" />
              </SelectTrigger>
              <SelectContent>
                {workspace.taxEntities.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} · {percent(option.rateBasisPoints)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="termsTemplateId">Contract terms template</Label>
            <Select
              name="termsTemplateId"
              defaultValue={estimate.termsTemplateId ?? undefined}
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
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label htmlFor="contractTerms">Pertinent contract terms</Label>
            <Textarea
              id="contractTerms"
              name="contractTerms"
              rows={6}
              defaultValue={estimate.contractTerms ?? ""}
              disabled={!editable}
              placeholder="Use a template or draft the estimate-specific terms here."
            />
          </div>
        </div>
        {editable && (
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={isPending}>Save draft details</Button>
          </div>
        )}
      </form>

      <section className="clarity-panel-strong p-4">
        <div className="mb-4">
          <h2 className="font-semibold">CSI estimate</h2>
          <p className="text-xs text-muted-foreground">
            Select a division first, then add the Sage cost codes needed within
            it. Each division subtotal updates from its lines.
          </p>
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
                      <div key={item.id} className="grid gap-2 py-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                        <div>
                          <p className="text-sm font-medium">
                            {item.costCode} · {item.description}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantity} {item.unit} × {money(item.unitCostCents)} ·
                            markup {percent(item.markupRateBasisPoints)}
                            {item.taxable
                              ? ` · ${item.taxCode ?? "tax"} ${percent(item.taxRateBasisPoints)}`
                              : " · non-taxable"}
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
                                onClick={() => setLine(lineDraft(item))}
                              >
                                Edit
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
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {editable && (
          <form className="mt-5 border-t pt-4" onSubmit={saveLine}>
            <h3 className="mb-3 text-sm font-semibold">
              {line.id ? "Edit estimate line" : "Add estimate line"}
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
                <Select
                  value={line.costCode}
                  onValueChange={(value) => setLine({ ...line, costCode: value })}
                  disabled={!line.divisionCode}
                >
                  <SelectTrigger><SelectValue placeholder="Choose cost code" /></SelectTrigger>
                  <SelectContent>
                    {availableCostCodes.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimateUnit">Unit</Label>
                <Input id="estimateUnit" name="unit" value={line.unit} onChange={(event) => setLine({ ...line, unit: event.target.value })} />
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
                <Input id="estimateQuantity" name="quantity" inputMode="decimal" value={line.quantity} onChange={(event) => setLine({ ...line, quantity: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimateUnitCost">Unit cost</Label>
                <Input id="estimateUnitCost" name="unitCost" inputMode="decimal" value={line.unitCost} onChange={(event) => setLine({ ...line, unitCost: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimateMarkup">Line markup %</Label>
                <Input id="estimateMarkup" name="markupPercent" inputMode="decimal" value={line.markupPercent} onChange={(event) => setLine({ ...line, markupPercent: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tax entity</Label>
                <Select value={line.taxEntityId} onValueChange={(value) => setLine({ ...line, taxEntityId: value })} disabled={!line.taxable}>
                  <SelectTrigger><SelectValue placeholder="Project default" /></SelectTrigger>
                  <SelectContent>
                    {workspace.taxEntities.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label} · {percent(option.rateBasisPoints)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={line.taxable} onCheckedChange={(checked) => setLine({ ...line, taxable: checked === true })} />
                Taxable line
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={line.ownerVisible} onCheckedChange={(checked) => setLine({ ...line, ownerVisible: checked === true })} />
                Owner-visible
              </label>
              <div className="ml-auto flex gap-2">
                {line.id && <Button type="button" variant="ghost" onClick={() => setLine(EMPTY_LINE)}>Cancel edit</Button>}
                <Button type="submit" disabled={isPending || !line.costCode}>
                  <IconPlus className="size-4" /> {line.id ? "Save line" : "Add line"}
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
              {document.driveUrl && <Button variant="outline" size="sm" asChild><Link href={document.driveUrl} target="_blank">Open</Link></Button>}
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
              Preparing the package locks this version. Recording the completed
              Foxit package accepts it and creates the original G703 budget.
            </p>
            {editable && (
              <Button className="mt-3" onClick={prepareFoxit} disabled={isPending || workspace.lines.length === 0}>
                <IconSend className="size-4" />Prepare CA22 for Foxit
              </Button>
            )}
            {estimate.status === "signature_pending" && workspace.canEdit && (
              <form className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2" onSubmit={acceptSigned}>
                <div className="space-y-1.5"><Label htmlFor="signedDocumentUrl">Signed Foxit document link</Label><Input id="signedDocumentUrl" name="signedDocumentUrl" type="url" required /></div>
                <div className="space-y-1.5"><Label htmlFor="foxitEnvelopeId">Foxit envelope ID</Label><Input id="foxitEnvelopeId" name="foxitEnvelopeId" /></div>
                <div className="md:col-span-2"><Button type="submit" disabled={isPending}>Record signatures and accept estimate</Button></div>
              </form>
            )}
            {estimate.status === "accepted" && (
              <p className="mt-3 text-sm font-medium text-emerald-700">
                Accepted estimate is locked. Budget changes now require an executed change order.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
