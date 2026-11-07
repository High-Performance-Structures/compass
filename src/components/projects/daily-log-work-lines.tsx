"use client"

import { ON_BUDGET_GROUP, INTERNAL_CODES_GROUP } from "@/lib/daily-logs/cost-code-groups"

import * as React from "react"
import { IconPlus, IconX } from "@tabler/icons-react"

import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReorderHandle, SortableRow, SortableRows, SortByCostCodeButton } from "@/components/ui/sortable-rows"
import {
  emptyWorkLine,
  parseWorkLineHours,
  type DailyLogCostCodeOption,
  type DailyLogWorkLineDraft,
} from "@/lib/daily-logs/daily-log-form"
import { moveLine, sortLinesByCostCode } from "@/lib/shared/line-order"
import { cn } from "@/lib/utils"

/** "Required" beside a field's label. */
export function RequiredMark(): React.ReactElement {
  return <span className="ml-1 text-xs font-normal text-destructive">Required</span>
}

/** A field's error, linked to its input by id for screen readers. */
export function FieldError({ id, message }: { readonly id: string; readonly message: string | undefined }): React.ReactElement | null {
  if (!message) return null
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  )
}

/**
 * The cost codes worked on: one row per code with its time and a short
 * description, plus the day's total.
 */
export function DailyLogWorkLines({
  idPrefix,
  lines,
  costCodes,
  required,
  errors,
  onChange,
  todoTitles,
}: {
  readonly idPrefix: string
  readonly lines: readonly DailyLogWorkLineDraft[]
  readonly costCodes: readonly DailyLogCostCodeOption[]
  readonly required: boolean
  /** Error messages keyed like "workLines" or "workLines.0.hours". */
  readonly errors: ReadonlyMap<string, string>
  readonly onChange: (lines: readonly DailyLogWorkLineDraft[]) => void
  /** Titles of to-dos lines can belong to, to label those lines. */
  readonly todoTitles?: ReadonlyMap<string, string>
}): React.ReactElement {
  const options = React.useMemo(
    () =>
      costCodes.map((option) => ({
        value: option.code,
        onBudget: option.group === ON_BUDGET_GROUP,
        label: option.label,
        description: option.group || undefined,
        keywords: `${option.code} ${option.name}`,
      })),
    [costCodes],
  )
  const total = lines.reduce((sum, line) => {
    const hours = parseWorkLineHours(line.hours)
    return hours.ok ? sum + hours.hours : sum
  }, 0)
  const sectionError = errors.get("workLines")

  function update(index: number, patch: Partial<DailyLogWorkLineDraft>): void {
    onChange(lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)))
  }

  return (
    <fieldset className="grid gap-2" aria-describedby={sectionError ? `${idPrefix}-lines-error` : undefined}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <legend className="text-sm font-medium">
          Cost codes and time
          {required && <RequiredMark />}
        </legend>
        <p className="text-xs text-muted-foreground tabular-nums">
          Total {total.toLocaleString("en-US", { maximumFractionDigits: 2 })} hours
        </p>
      </div>
      {/* Draft lines have no ids; position ids are enough because the order saves with the log. */}
      <SortableRows ids={lines.map((_, index) => `line-${index}`)} onMove={(from, to) => onChange(moveLine(lines, from, to))}>
        <div className="grid gap-2">
          {lines.map((line, index) => {
            const codeError = errors.get(`workLines.${index}.costCode`)
            const hoursError = errors.get(`workLines.${index}.hours`)
            const todoTitle = line.todoId ? todoTitles?.get(line.todoId) : undefined
            return (
              <SortableRow
                key={index}
                id={`line-${index}`}
                index={index}
                className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2 border-b bg-background pb-2 md:grid-cols-[2.75rem_minmax(0,1.4fr)_6rem_minmax(0,1.6fr)_auto] md:items-start"
              >
                {todoTitle && (
                  <p className="col-span-2 text-xs text-info md:col-span-5">For the to-do: {todoTitle}</p>
                )}
                <div className="row-span-4 pt-0.5 md:row-span-1">
                  <ReorderHandle label={`cost code ${index + 1}`} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${idPrefix}-line-${index}-code`} className="sr-only">
                    Cost code {index + 1}
                  </Label>
                  <SearchableCombobox
                    id={`${idPrefix}-line-${index}-code`}
                    ariaLabel={`Cost code ${index + 1}`}
                    ariaDescribedBy={codeError ? `${idPrefix}-line-${index}-code-error` : undefined}
                    options={options}
                    browseValues={costCodes.some((option) => option.group === INTERNAL_CODES_GROUP) ? costCodes.filter((option) => option.group === INTERNAL_CODES_GROUP).map((option) => option.code) : undefined}
                    browseHeading={costCodes.some((option) => option.group === INTERNAL_CODES_GROUP) ? INTERNAL_CODES_GROUP : undefined}
                    searchHint={costCodes.some((option) => option.group === INTERNAL_CODES_GROUP) ? "Type to search the full company cost-code list." : undefined}
                    value={line.costCode}
                    onValueChange={(costCode) => update(index, { costCode })}
                    placeholder="Choose a cost code"
                    searchPlaceholder="Search cost codes..."
                    emptyMessage="No matching cost codes."
                    className={cn("h-9", codeError && "border-destructive")}
                  />
                  <FieldError id={`${idPrefix}-line-${index}-code-error`} message={codeError} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${idPrefix}-line-${index}-hours`} className="sr-only">
                    Hours for cost code {index + 1}
                  </Label>
                  <Input
                    id={`${idPrefix}-line-${index}-hours`}
                    inputMode="decimal"
                    value={line.hours}
                    onChange={(event) => update(index, { hours: event.currentTarget.value })}
                    placeholder="Hours"
                    aria-invalid={hoursError ? true : undefined}
                    aria-describedby={hoursError ? `${idPrefix}-line-${index}-hours-error` : undefined}
                    className="tabular-nums"
                  />
                  <FieldError id={`${idPrefix}-line-${index}-hours-error`} message={hoursError} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${idPrefix}-line-${index}-description`} className="sr-only">
                    What was done on cost code {index + 1}
                  </Label>
                  <Input
                    id={`${idPrefix}-line-${index}-description`}
                    value={line.description}
                    onChange={(event) => update(index, { description: event.currentTarget.value })}
                    placeholder="Brief description"
                    maxLength={500}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove cost code ${index + 1}`}
                  disabled={lines.length === 1 && !line.costCode && !line.hours && !line.description}
                  onClick={() => onChange(lines.length === 1 ? [emptyWorkLine()] : lines.filter((_, lineIndex) => lineIndex !== index))}
                >
                  <IconX className="size-4" />
                </Button>
              </SortableRow>
            )
          })}
        </div>
      </SortableRows>
      <FieldError id={`${idPrefix}-lines-error`} message={sectionError} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyWorkLine()])}>
          <IconPlus className="size-4" />
          Add cost code
        </Button>
        <SortByCostCodeButton
          label="cost codes"
          disabled={lines.length < 2}
          onSort={() => onChange(sortLinesByCostCode(lines, (line) => line.costCode))}
        />
      </div>
    </fieldset>
  )
}
