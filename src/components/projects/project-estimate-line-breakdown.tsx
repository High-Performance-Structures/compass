"use client"

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import {
  IconChevronDown,
  IconChevronRight,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deleteProjectEstimateLineCostItem,
  saveProjectEstimateLineCostItem,
  type ProjectEstimateCostCodeOption,
  type ProjectEstimateLineCostItem,
  type ProjectEstimateLineItem,
  type ProjectEstimateTaxOption,
} from "@/app/actions/project-estimates"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { EstimateUnitInput } from "@/components/estimate-unit-input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { calculateEstimateLine } from "@/lib/financials/estimate-ledger"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function numericValue(value: string): number | null {
  const parsed = Number(value.replaceAll(",", ""))
  return Number.isFinite(parsed) ? parsed : null
}

function percent(basisPoints: number): string {
  return `${basisPoints / 100}%`
}

type CostCodeDraft = {
  readonly id: string | null
  readonly divisionCode: string
  readonly costCode: string
  readonly description: string
  readonly quantity: string
  readonly unit: string
  readonly unitCost: string
  readonly markupPercent: string
  readonly taxable: boolean
  readonly taxEntityId: string
}

function emptyCostCode(
  line: ProjectEstimateLineItem,
  defaultTaxEntityId: string
): CostCodeDraft {
  return {
    id: null,
    divisionCode: line.divisionCode,
    costCode: "",
    description: "",
    quantity: "1",
    unit: "",
    unitCost: "",
    markupPercent: String(line.markupRateBasisPoints / 100),
    taxable: line.taxable,
    taxEntityId: line.taxEntityId ?? defaultTaxEntityId,
  }
}

function costCodeDraft(item: ProjectEstimateLineCostItem): CostCodeDraft {
  return {
    id: item.id,
    divisionCode: item.divisionCode,
    costCode: item.costCode,
    description: item.description,
    quantity: String(item.quantity),
    unit: item.unit,
    unitCost: String(item.unitCostCents / 100),
    markupPercent: String(item.markupRateBasisPoints / 100),
    taxable: item.taxable,
    taxEntityId: item.taxEntityId ?? "",
  }
}

export function ProjectEstimateLineBreakdown({
  projectId,
  estimateId,
  line,
  costCodes,
  taxEntities,
  defaultTaxRateBasisPoints,
  defaultTaxEntityId,
  editable,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly line: ProjectEstimateLineItem
  readonly costCodes: readonly ProjectEstimateCostCodeOption[]
  readonly taxEntities: readonly ProjectEstimateTaxOption[]
  readonly defaultTaxRateBasisPoints: number
  readonly defaultTaxEntityId: string
  readonly editable: boolean
}): React.ReactElement | null {
  const router = useRouter()
  const editorRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [draft, setDraft] = useState<CostCodeDraft>(() =>
    emptyCostCode(line, defaultTaxEntityId)
  )
  const divisions = useMemo(() => {
    const options = new Map<string, string>()
    for (const option of costCodes) {
      options.set(option.divisionCode, option.divisionLabel)
    }
    return [...options.entries()].sort((left, right) =>
      left[0].localeCompare(right[0])
    )
  }, [costCodes])
  const availableCostCodes = costCodes.filter(
    (option) => option.divisionCode === draft.divisionCode
  )
  const taxEntityOptions = useMemo(
    () =>
      taxEntities.map((option) => ({
        value: option.value,
        label: option.label,
        selectedLabel: `${option.label} · ${percent(option.rateBasisPoints)}`,
        description: `${percent(option.rateBasisPoints)} · Sage tax entity`,
        keywords: `${option.code} ${option.rateBasisPoints / 100}`,
      })),
    [taxEntities]
  )
  const previewQuantity = numericValue(draft.quantity) ?? 0
  const previewUnitCost = numericValue(draft.unitCost) ?? 0
  const previewMarkupRateBasisPoints = Math.round(
    (numericValue(draft.markupPercent) ?? 0) * 100
  )
  const selectedTaxEntity = taxEntities.find(
    (option) => option.value === draft.taxEntityId
  )
  const preview = calculateEstimateLine({
    quantity: previewQuantity,
    unitCostCents: Math.round(Math.max(0, previewUnitCost) * 100),
    markupRateBasisPoints: previewMarkupRateBasisPoints,
    taxable: draft.taxable,
    taxRateBasisPoints:
      selectedTaxEntity?.rateBasisPoints ?? defaultTaxRateBasisPoints,
  })

  if (!editable && line.costItems.length === 0) return null

  function saveCostCode(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveProjectEstimateLineCostItem(
        projectId,
        estimateId,
        line.id,
        draft.id,
        {
          costCode: draft.costCode,
          description: draft.description,
          quantity: numericValue(draft.quantity),
          unit: draft.unit,
          unitCost: numericValue(draft.unitCost),
          markupPercent: numericValue(draft.markupPercent),
          taxable: draft.taxable,
          taxEntityId: draft.taxEntityId,
        }
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        draft.id
          ? "Breakdown cost code updated"
          : "Breakdown cost code added"
      )
      setDraft(emptyCostCode(line, defaultTaxEntityId))
      setOpen(true)
      router.refresh()
    })
  }

  function editCostCode(item: ProjectEstimateLineCostItem): void {
    setDraft(costCodeDraft(item))
    // The shared editor follows the breakdown list, so bring it into view after
    // React populates it with the selected item's values.
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      editorRef.current
        ?.querySelector<HTMLInputElement>(
          `#breakdown-description-${line.id}`
        )
        ?.focus({ preventScroll: true })
    })
  }

  function removeCostCode(item: ProjectEstimateLineCostItem): void {
    const finalItem = line.costItems.length === 1
    const confirmed = window.confirm(
      finalItem
        ? `Delete ${item.costCode}? This removes the breakdown and returns the parent line to simple lump-sum pricing at its current calculated amount.`
        : `Delete ${item.costCode} from this line's cost breakdown?`
    )
    if (!confirmed) return
    startTransition(async () => {
      const result = await deleteProjectEstimateLineCostItem(
        projectId,
        estimateId,
        line.id,
        item.id
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (draft.id === item.id) {
        setDraft(emptyCostCode(line, defaultTaxEntityId))
      }
      toast.success("Breakdown cost code deleted")
      router.refresh()
    })
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="px-0">
          {open ? (
            <IconChevronDown className="size-4" />
          ) : (
            <IconChevronRight className="size-4" />
          )}
          {line.costItems.length === 0
            ? "Build cost breakdown"
            : `${line.costItems.length} breakdown ${line.costItems.length === 1 ? "cost code" : "cost codes"} · ${money(line.lineTotalCents)}`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 border-t pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Line cost breakdown</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose CSI/Sage cost codes just like a parent estimate line. Set
              the unit type, markup, and taxability for each item. The parent
              line becomes a summary of those calculated amounts; builder-fee
              eligibility remains on the parent line.
            </p>
          </div>
          <p className="text-sm font-semibold">
            Line total {money(line.lineTotalCents)}
          </p>
        </div>

        {line.costItems.length > 0 ? (
          <div className="mt-3 divide-y border-y">
            {line.costItems.map((item) => (
              <div
                key={item.id}
                className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <p className="text-sm font-medium">
                    {item.costCode} · {item.costCodeName}
                  </p>
                  {item.description.trim() !== item.costCodeName.trim() && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {item.divisionCode} · {item.divisionName} · {item.quantity}{" "}
                    {item.unit} × {money(item.unitCostCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Direct {money(item.directCostCents)} · Markup{" "}
                    {percent(item.markupRateBasisPoints)} ({money(item.markupCents)}) ·{" "}
                    {item.taxable
                      ? `${item.taxName ?? item.taxCode ?? "Taxable"} ${percent(item.taxRateBasisPoints)} (${money(item.taxCents)})`
                      : "Not taxable"}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-sm font-medium">
                    {money(item.lineTotalCents)}
                  </span>
                  {editable && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => editCostCode(item)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${item.costCode}`}
                        disabled={isPending}
                        onClick={() => removeCostCode(item)}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 border-y py-3 text-sm text-muted-foreground">
            Add the first cost code to replace the parent line&apos;s simple
            quantity × unit-cost calculation with a detailed subtotal.
          </p>
        )}

        {editable && (
          <form
            ref={editorRef}
            onSubmit={saveCostCode}
            className="mt-4 scroll-mt-4 border-t pt-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold">
                {draft.id
                  ? "Edit breakdown cost code"
                  : "Add breakdown cost code"}
              </h4>
              <p className="text-xs text-muted-foreground">
                Calculated amount {money(preview.lineTotalCents)}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <Label>CSI division</Label>
                <Select
                  value={draft.divisionCode}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      divisionCode: value,
                      costCode: "",
                      description: "",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose division first" />
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
              <div className="space-y-1.5 md:col-span-1 xl:col-span-3">
                <Label>Cost code</Label>
                <SearchableCombobox
                  ariaLabel="Breakdown cost code"
                  options={availableCostCodes}
                  value={draft.costCode}
                  onValueChange={(value) => {
                    const option = costCodes.find(
                      (candidate) => candidate.value === value
                    )
                    setDraft({
                      ...draft,
                      costCode: value,
                      description: option?.description ?? draft.description,
                    })
                  }}
                  disabled={!draft.divisionCode}
                  placeholder="Choose cost code"
                  searchPlaceholder="Search Sage cost codes..."
                  emptyMessage="No matching Sage cost codes."
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                <Label htmlFor={`breakdown-description-${line.id}`}>
                  Description
                </Label>
                <Input
                  id={`breakdown-description-${line.id}`}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`breakdown-quantity-${line.id}`}>
                  Quantity
                </Label>
                <Input
                  id={`breakdown-quantity-${line.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0.0001"
                  step="any"
                  value={draft.quantity}
                  onChange={(event) =>
                    setDraft({ ...draft, quantity: event.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`breakdown-unit-${line.id}`}>Unit type</Label>
                <EstimateUnitInput
                  id={`breakdown-unit-${line.id}`}
                  value={draft.unit}
                  onValueChange={(value) =>
                    setDraft({ ...draft, unit: value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`breakdown-unit-cost-${line.id}`}>
                  Unit cost
                </Label>
                <Input
                  id={`breakdown-unit-cost-${line.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={draft.unitCost}
                  onChange={(event) =>
                    setDraft({ ...draft, unitCost: event.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`breakdown-markup-${line.id}`}>
                  Markup %
                </Label>
                <Input
                  id={`breakdown-markup-${line.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={draft.markupPercent}
                  onChange={(event) =>
                    setDraft({ ...draft, markupPercent: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Tax entity</Label>
                <SearchableCombobox
                  value={draft.taxEntityId}
                  onValueChange={(value) =>
                    setDraft({ ...draft, taxEntityId: value })
                  }
                  disabled={!draft.taxable}
                  options={[
                    {
                      value: "",
                      label: "Use project tax entity",
                      keywords: "default inherit clear",
                    },
                    ...taxEntityOptions,
                  ]}
                  ariaLabel="Breakdown cost item tax entity"
                  placeholder="Use project tax entity"
                  searchPlaceholder="Search Sage tax entities..."
                  emptyMessage="No matching Sage tax entities."
                  groupHeading="Active Sage tax entities"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.taxable}
                  onCheckedChange={(checked) => {
                    const taxable = checked === true
                    setDraft({
                      ...draft,
                      taxable,
                      taxEntityId:
                        taxable && !draft.taxEntityId
                          ? defaultTaxEntityId
                          : draft.taxEntityId,
                    })
                  }}
                />
                Taxable cost item
              </label>
              <div className="flex items-end justify-end gap-2">
                {draft.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setDraft(emptyCostCode(line, defaultTaxEntityId))
                    }
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={
                    isPending || !draft.costCode || preview.lineTotalCents <= 0
                  }
                >
                  {draft.id ? (
                    <IconDeviceFloppy className="size-4" />
                  ) : (
                    <IconPlus className="size-4" />
                  )}
                  {draft.id ? "Save cost code" : "Add cost code"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
