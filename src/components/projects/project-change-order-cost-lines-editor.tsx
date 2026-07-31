"use client"

import * as React from "react"
import {
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"

import type {
  ProjectChangeOrderCostCodeOption,
  ProjectChangeOrderItem,
  ProjectChangeOrderPhaseOption,
} from "@/app/actions/project-change-orders"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { ChangeOrderCostLineInput } from "@/lib/change-orders/cost-lines"

export type DraftChangeOrderCostLine = {
  readonly id: string
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly amount: string
}

type ChangeOrderLineField =
  | "description"
  | "phaseCode"
  | "costCode"
  | "amount"

type CodingOption = {
  readonly value: string
  readonly label: string
  readonly description?: string
}

const LINE_INPUT_CLASS =
  "h-8 rounded-none border-0 bg-transparent px-1 shadow-none focus-visible:bg-background focus-visible:ring-0"

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function ProjectChangeOrderOptionPicker({
  value,
  options,
  placeholder,
  ariaLabel,
  disabled,
  onValueChange,
}: {
  readonly value: string
  readonly options: readonly CodingOption[]
  readonly placeholder: string
  readonly ariaLabel: string
  readonly disabled: boolean
  readonly onValueChange: (value: string) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const normalizedQuery = normalize(query)
  const selected = options.find((option) => option.value === value) ?? null
  const filteredOptions = options.filter((option) =>
    normalizedQuery.length === 0
      ? true
      : normalize(
          `${option.value} ${option.label} ${option.description ?? ""}`
        ).includes(normalizedQuery)
  )
  const typedValue = query.trim()
  const canUseTypedValue =
    typedValue.length > 0 && normalize(typedValue) !== normalize(value)

  function chooseValue(nextValue: string): void {
    onValueChange(nextValue)
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          aria-label={ariaLabel}
          className="h-8 w-full min-w-0 justify-between rounded-none bg-transparent px-1 text-left text-xs font-normal hover:bg-background"
        >
          <span className="truncate">
            {selected?.label ?? (value || placeholder)}
          </span>
          <IconChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(26rem,calc(100vw-3rem))] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={`Search ${placeholder.toLowerCase()}...`}
          />
          <CommandList className="compass-content-scroll max-h-72">
            <CommandEmpty>No matching options.</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.value} ${option.label}`}
                  onSelect={() => chooseValue(option.value)}
                >
                  <IconCheck
                    className={
                      option.value === value
                        ? "size-4 opacity-100"
                        : "size-4 opacity-0"
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => chooseValue("")}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUseTypedValue}
              onClick={() => chooseValue(typedValue)}
            >
              Use typed value
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function newDraftChangeOrderCostLine(
  initial?: Partial<Omit<DraftChangeOrderCostLine, "id">>
): DraftChangeOrderCostLine {
  return {
    id: crypto.randomUUID(),
    description: initial?.description ?? "",
    phaseCode: initial?.phaseCode ?? "",
    costCode: initial?.costCode ?? "",
    amount: initial?.amount ?? "",
  }
}

export function initialDraftChangeOrderCostLines(
  lines: ProjectChangeOrderItem["lines"],
  legacyAmountCents: number | null
): readonly DraftChangeOrderCostLine[] {
  if (lines.length > 0) {
    return lines.map((line) =>
      newDraftChangeOrderCostLine({
        description: line.description,
        phaseCode: line.phaseCode ?? "",
        costCode: line.costCode ?? "",
        amount:
          line.amountCents === null
            ? ""
            : (line.amountCents / 100).toFixed(2),
      })
    )
  }
  return [
    newDraftChangeOrderCostLine({
      description: legacyAmountCents === null ? "" : "Existing change order amount",
      amount:
        legacyAmountCents === null ? "" : (legacyAmountCents / 100).toFixed(2),
    }),
  ]
}

function amountCents(value: string): number | null {
  const trimmed = value.replaceAll(",", "").trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN
}

export function toChangeOrderCostLineInput(
  line: DraftChangeOrderCostLine
): ChangeOrderCostLineInput {
  return {
    description: line.description.trim() || null,
    phaseCode: line.phaseCode.trim() || null,
    costCode: line.costCode.trim() || null,
    amountCents: amountCents(line.amount),
  }
}

export function draftChangeOrderTotalCents(
  lines: readonly DraftChangeOrderCostLine[]
): number | null {
  const populatedLines = lines.filter(
    (line) =>
      line.description.trim().length > 0 ||
      line.phaseCode.trim().length > 0 ||
      line.costCode.trim().length > 0 ||
      line.amount.trim().length > 0
  )
  const amounts = populatedLines.map((line) => amountCents(line.amount))
  if (
    amounts.length === 0 ||
    amounts.some((amount) => amount === null || !Number.isFinite(amount))
  ) {
    return null
  }
  return amounts.reduce<number>(
    (total, amount) => total + (amount !== null ? amount : 0),
    0
  )
}

export function changeOrderMoney(cents: number | null): string {
  if (cents === null) return "Not yet priced"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function costCodesForPhase(
  options: readonly ProjectChangeOrderCostCodeOption[],
  phaseCode: string
): readonly ProjectChangeOrderCostCodeOption[] {
  const phase = phaseCode.trim()
  return phase.length === 0
    ? options
    : options.filter((option) => option.divisionCode === phase)
}

export function ProjectChangeOrderCostLinesEditor({
  lines,
  phaseOptions,
  costCodeOptions,
  disabled = false,
  onLinesChange,
}: {
  readonly lines: readonly DraftChangeOrderCostLine[]
  readonly phaseOptions: readonly ProjectChangeOrderPhaseOption[]
  readonly costCodeOptions: readonly ProjectChangeOrderCostCodeOption[]
  readonly disabled?: boolean
  readonly onLinesChange: (lines: readonly DraftChangeOrderCostLine[]) => void
}): React.ReactElement {
  function updateLine(
    id: string,
    field: ChangeOrderLineField,
    value: string
  ): void {
    onLinesChange(
      lines.map((line) =>
        line.id === id ? { ...line, [field]: value } : line
      )
    )
  }

  function removeLine(id: string): void {
    if (lines.length === 1) return
    onLinesChange(lines.filter((line) => line.id !== id))
  }

  const totalCents = draftChangeOrderTotalCents(lines)
  const codedCount = lines.filter((line) => line.costCode.trim().length > 0).length

  return (
    <div className="border-y">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b py-2">
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Cost lines
          </h3>
          <p className="text-xs text-muted-foreground">
            Use one line per scope item or accounting cost code.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">
            {changeOrderMoney(totalCents)}
          </span>
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onLinesChange([...lines, newDraftChangeOrderCostLine()])
              }
            >
              <IconPlus className="size-4" />
              Add line
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          <div className="grid grid-cols-[2rem_minmax(14rem,1fr)_12rem_16rem_8rem_2.5rem] gap-2 border-b py-2 text-xs font-medium text-muted-foreground">
            <span>#</span>
            <span>Description</span>
            <span>Phase</span>
            <span>Cost code</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {lines.map((line, index) => (
            <div
              key={line.id}
              className="grid grid-cols-[2rem_minmax(14rem,1fr)_12rem_16rem_8rem_2.5rem] gap-2 border-b py-2 last:border-b-0"
            >
              <span className="pt-2 text-xs font-medium text-muted-foreground">
                {index + 1}
              </span>
              <Input
                value={line.description}
                disabled={disabled}
                onChange={(event) =>
                  updateLine(line.id, "description", event.target.value)
                }
                placeholder="Scope or cost description"
                className={LINE_INPUT_CLASS}
              />
              <ProjectChangeOrderOptionPicker
                value={line.phaseCode}
                options={phaseOptions}
                placeholder="Phase"
                ariaLabel={`Choose phase for change order line ${index + 1}`}
                disabled={disabled}
                onValueChange={(value) =>
                  updateLine(line.id, "phaseCode", value)
                }
              />
              <ProjectChangeOrderOptionPicker
                value={line.costCode}
                options={costCodesForPhase(costCodeOptions, line.phaseCode)}
                placeholder="Cost code"
                ariaLabel={`Choose cost code for change order line ${index + 1}`}
                disabled={disabled}
                onValueChange={(value) =>
                  updateLine(line.id, "costCode", value)
                }
              />
              <Input
                value={line.amount}
                disabled={disabled}
                onChange={(event) =>
                  updateLine(line.id, "amount", event.target.value)
                }
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Amount for change order line ${index + 1}`}
                className={`${LINE_INPUT_CLASS} text-right`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                disabled={disabled || lines.length === 1}
                onClick={() => removeLine(line.id)}
                aria-label={`Remove change order line ${index + 1}`}
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm">
        <span className="text-muted-foreground">
          {codedCount}/{lines.length} lines coded
        </span>
        <span>
          Change order total: <strong>{changeOrderMoney(totalCents)}</strong>
        </span>
      </div>
    </div>
  )
}
