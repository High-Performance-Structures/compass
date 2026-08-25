"use client"

import { useMemo, useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconArrowLeft,
  IconCircleCheck,
  IconCopy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  createEstimateTemplateRevision,
  deleteEstimateTemplateLine,
  publishEstimateTemplate,
  saveEstimateTemplateLine,
  updateEstimateTemplateDraft,
  type EstimateTemplateEditor,
  type EstimateTemplateEditorLine,
} from "@/app/actions/estimate-templates"
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
  readonly taxCode: string
  readonly ownerVisible: boolean
}

function blankLine(markupRateBasisPoints: number): LineDraft {
  return {
    id: null,
    divisionCode: "",
    costCode: "",
    description: "",
    specifications: "",
    quantity: "1",
    unit: "LS",
    unitCost: "",
    markupPercent: String(markupRateBasisPoints / 100),
    taxable: false,
    taxCode: "",
    ownerVisible: true,
  }
}

function editLine(line: EstimateTemplateEditorLine): LineDraft {
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
    taxCode: line.taxCode ?? "",
    ownerVisible: line.ownerVisible,
  }
}

function formText(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim()
  return value ? value : null
}

function formNumber(formData: FormData, name: string): number | null {
  const value = Number(String(formData.get(name) ?? "").replaceAll(",", ""))
  return Number.isFinite(value) ? value : null
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}%`
}

export function EstimateTemplateEditorPanel({
  editor,
}: {
  readonly editor: EstimateTemplateEditor
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [line, setLine] = useState<LineDraft>(() =>
    blankLine(editor.defaultMarkupRateBasisPoints)
  )
  const editable = editor.canEdit && editor.versionStatus === "draft"

  const divisions = useMemo(() => {
    const options = new Map<string, string>()
    for (const costCode of editor.costCodes) {
      options.set(
        costCode.divisionCode,
        `${costCode.divisionCode} · ${costCode.divisionName}`
      )
    }
    return [...options.entries()].sort((left, right) =>
      left[0].localeCompare(right[0])
    )
  }, [editor.costCodes])
  const availableCostCodes = editor.costCodes.filter(
    (costCode) => costCode.divisionCode === line.divisionCode
  )
  const groupedLines = useMemo(() => {
    const groups = new Map<string, EstimateTemplateEditorLine[]>()
    for (const item of editor.lines) {
      const current = groups.get(item.divisionCode) ?? []
      current.push(item)
      groups.set(item.divisionCode, current)
    }
    return [...groups.entries()].sort((left, right) =>
      left[0].localeCompare(right[0])
    )
  }, [editor.lines])

  function refresh(message: string): void {
    toast.success(message)
    router.refresh()
  }

  function saveHeader(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await updateEstimateTemplateDraft({
        templateId: editor.id,
        name: formText(formData, "name"),
        description: formText(formData, "description"),
        documentTitle: formText(formData, "documentTitle"),
        contractTerms: formText(formData, "contractTerms"),
        defaultMarkupPercent: formNumber(formData, "defaultMarkupPercent"),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      refresh("Estimate template details saved.")
    })
  }

  function saveLine(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveEstimateTemplateLine(editor.id, line.id, {
        costCode: line.costCode,
        description: formText(formData, "description"),
        specifications: formText(formData, "specifications"),
        quantity: formNumber(formData, "quantity"),
        unit: formText(formData, "unit"),
        unitCost: formNumber(formData, "unitCost"),
        markupPercent: formNumber(formData, "markupPercent"),
        taxable: line.taxable,
        taxCode: line.taxCode || null,
        ownerVisible: line.ownerVisible,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setLine(blankLine(editor.defaultMarkupRateBasisPoints))
      refresh(line.id ? "Template line updated." : "Template line added.")
    })
  }

  function removeLine(lineId: string): void {
    if (!window.confirm("Remove this line from the draft template?")) return
    startTransition(async () => {
      const result = await deleteEstimateTemplateLine(editor.id, lineId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setLine(blankLine(editor.defaultMarkupRateBasisPoints))
      refresh("Template line removed.")
    })
  }

  function publish(): void {
    if (
      !window.confirm(
        "Publish this version? It will become available in project estimate drop-downs."
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await publishEstimateTemplate(editor.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      refresh("Estimate template published.")
    })
  }

  function revise(): void {
    startTransition(async () => {
      const result = await createEstimateTemplateRevision(editor.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      refresh("Editable template revision created.")
    })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {editor.name}
              </h1>
              <Badge variant="outline">Estimate template</Badge>
              <Badge variant={editable ? "secondary" : "default"}>
                v{editor.versionNumber} · {editor.versionStatus}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Published versions populate independent project estimate drafts.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <Button onClick={publish} disabled={pending || editor.lines.length === 0}>
                <IconCircleCheck className="size-4" />
                Review and publish
              </Button>
            ) : editor.canEdit ? (
              <Button onClick={revise} disabled={pending}>
                <IconCopy className="size-4" />
                Create editable revision
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href="/dashboard/templates">
                <IconArrowLeft className="size-4" />
                Template Library
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <form
            key={`${editor.versionId}:${editor.name}:${editor.lines.length}`}
            className="clarity-panel-strong p-4"
            onSubmit={saveHeader}
          >
            <h2 className="font-semibold">Template details and contract language</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="templateName">Template name</Label>
                <Input
                  id="templateName"
                  name="name"
                  defaultValue={editor.name}
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="templateMarkup">Default markup %</Label>
                <Input
                  id="templateMarkup"
                  name="defaultMarkupPercent"
                  inputMode="decimal"
                  defaultValue={editor.defaultMarkupRateBasisPoints / 100}
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="templateDocumentTitle">Document title</Label>
                <Input
                  id="templateDocumentTitle"
                  name="documentTitle"
                  defaultValue={editor.documentTitle}
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="templateDescription">Library description</Label>
                <Input
                  id="templateDescription"
                  name="description"
                  defaultValue={editor.description ?? ""}
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                <Label htmlFor="templateTerms">Pertinent contract terms</Label>
                <Textarea
                  id="templateTerms"
                  name="contractTerms"
                  rows={7}
                  defaultValue={editor.contractTerms ?? ""}
                  disabled={!editable}
                  placeholder="Reusable contract language copied into each new estimate draft."
                />
              </div>
            </div>
            {editable && (
              <div className="mt-4 flex justify-end">
                <Button type="submit" disabled={pending}>
                  Save template details
                </Button>
              </div>
            )}
          </form>

          <section className="clarity-panel-strong p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">CSI scope and cost-code lines</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Template amounts may remain zero until the project is priced.
                  Taxable lines can use the project tax entity or a fixed tax code.
                </p>
              </div>
              <Badge variant="outline">
                {editor.lines.length} {editor.lines.length === 1 ? "line" : "lines"}
              </Badge>
            </div>

            {groupedLines.length === 0 ? (
              <p className="mt-5 text-sm text-muted-foreground">
                Add the first division and cost-code line below.
              </p>
            ) : (
              <div className="mt-5 space-y-5">
                {groupedLines.map(([divisionCode, items]) => (
                  <div key={divisionCode} className="border-l-2 border-l-primary pl-4">
                    <div className="border-b pb-2">
                      <h3 className="text-sm font-semibold">
                        {divisionCode} · {items[0]?.divisionName}
                      </h3>
                    </div>
                    <div className="divide-y">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                        >
                          <div>
                            <p className="text-sm font-medium">
                              {item.costCode} · {item.description}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.quantity} {item.unit} × {money(item.unitCostCents)} · markup{" "}
                              {percent(item.markupRateBasisPoints)}
                              {item.taxable
                                ? ` · taxable ${item.taxCode ?? "at project rate"}`
                                : " · non-taxable"}
                              {item.ownerVisible ? " · owner visible" : " · internal only"}
                            </p>
                          </div>
                          {editable && (
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setLine(editLine(item))}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => removeLine(item.id)}
                                aria-label={`Remove ${item.description}`}
                              >
                                <IconTrash className="size-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {editable && (
            <form className="clarity-panel-strong p-4" onSubmit={saveLine}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">
                  {line.id ? "Edit template line" : "Add template line"}
                </h2>
                {line.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setLine(blankLine(editor.defaultMarkupRateBasisPoints))
                    }
                  >
                    Cancel edit
                  </Button>
                )}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>CSI division</Label>
                  <Select
                    value={line.divisionCode}
                    onValueChange={(divisionCode) =>
                      setLine({ ...line, divisionCode, costCode: "" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose division" />
                    </SelectTrigger>
                    <SelectContent>
                      {divisions.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Cost code</Label>
                  <Select
                    value={line.costCode}
                    onValueChange={(costCode) =>
                      setLine({ ...line, costCode })
                    }
                    disabled={!line.divisionCode}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose cost code" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCostCodes.map((costCode) => (
                        <SelectItem key={costCode.value} value={costCode.value}>
                          {costCode.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="templateUnit">Unit</Label>
                  <Input
                    id="templateUnit"
                    name="unit"
                    value={line.unit}
                    onChange={(event) =>
                      setLine({ ...line, unit: event.currentTarget.value })
                    }
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="templateLineDescription">Description</Label>
                  <Input
                    id="templateLineDescription"
                    name="description"
                    value={line.description}
                    onChange={(event) =>
                      setLine({ ...line, description: event.currentTarget.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="templateLineSpecifications">
                    Specifications / scope notes
                  </Label>
                  <Input
                    id="templateLineSpecifications"
                    name="specifications"
                    value={line.specifications}
                    onChange={(event) =>
                      setLine({
                        ...line,
                        specifications: event.currentTarget.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="templateQuantity">Quantity</Label>
                  <Input
                    id="templateQuantity"
                    name="quantity"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) =>
                      setLine({ ...line, quantity: event.currentTarget.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="templateUnitCost">Default unit cost</Label>
                  <Input
                    id="templateUnitCost"
                    name="unitCost"
                    inputMode="decimal"
                    value={line.unitCost}
                    onChange={(event) =>
                      setLine({ ...line, unitCost: event.currentTarget.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="templateLineMarkup">Markup %</Label>
                  <Input
                    id="templateLineMarkup"
                    name="markupPercent"
                    inputMode="decimal"
                    value={line.markupPercent}
                    onChange={(event) =>
                      setLine({
                        ...line,
                        markupPercent: event.currentTarget.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tax treatment</Label>
                  <Select
                    value={line.taxCode || "project-default"}
                    onValueChange={(value) =>
                      setLine({
                        ...line,
                        taxCode: value === "project-default" ? "" : value,
                      })
                    }
                    disabled={!line.taxable}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Project tax entity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project-default">
                        Use project tax entity
                      </SelectItem>
                      {editor.taxCodes.map((taxCode) => (
                        <SelectItem key={taxCode.value} value={taxCode.value}>
                          {taxCode.label} · {percent(taxCode.rateBasisPoints)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Checkbox
                    id="templateTaxable"
                    checked={line.taxable}
                    onCheckedChange={(checked) =>
                      setLine({ ...line, taxable: checked === true })
                    }
                  />
                  <Label htmlFor="templateTaxable">Taxable</Label>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Checkbox
                    id="templateOwnerVisible"
                    checked={line.ownerVisible}
                    onCheckedChange={(checked) =>
                      setLine({ ...line, ownerVisible: checked === true })
                    }
                  />
                  <Label htmlFor="templateOwnerVisible">Owner visible</Label>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  type="submit"
                  disabled={pending || !line.costCode || !line.description.trim()}
                >
                  <IconPlus className="size-4" />
                  {line.id ? "Save line" : "Add line"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
