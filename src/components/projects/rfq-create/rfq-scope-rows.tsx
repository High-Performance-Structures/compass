"use client"

import { IconPlus, IconTrash } from "@tabler/icons-react"

import type { ProjectRfqCostCodeOption } from "@/lib/domain/operations/types"
import {
  ProjectRfqCostCodePicker,
  ProjectRfqDivisionPicker,
} from "@/components/projects/project-rfq-cost-code-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ReorderHandle, SortableRow, SortableRows, SortByCostCodeButton } from "@/components/ui/sortable-rows"
import { moveLine, sortLinesByCostCode } from "@/lib/shared/line-order"

import { LINE_INPUT_CLASS, type RfqLineField } from "./rfq-draft"

type ScopeLine = {
  readonly id: string
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly notes: string
}

/** The scope-row state the RFQ create and edit forms each keep. */
export type RfqScopeRowsState<L extends ScopeLine> = {
  readonly lines: readonly L[]
  readonly setLines: React.Dispatch<React.SetStateAction<readonly L[]>>
  readonly addLine: () => void
  readonly removeLine: (id: string) => void
  readonly updateLine: (id: string, field: RfqLineField, value: string) => void
  readonly updateLineDivision: (id: string, divisionCode: string) => void
  readonly updateLineCostCode: (id: string, costCode: string) => void
}

/** "Scope rows": description, Sage division and cost code, and notes, in the order dragged. */
export function RfqScopeRows<L extends ScopeLine>({
  rows,
  costCodeOptions,
}: {
  readonly rows: RfqScopeRowsState<L>
  readonly costCodeOptions: readonly ProjectRfqCostCodeOption[]
}): React.ReactElement {
  const {
    lines,
    setLines,
    addLine,
    removeLine,
    updateLine,
    updateLineDivision,
    updateLineCostCode,
  } = rows
  return (
          <div className="border-y">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  Scope rows
                </h3>
                <p className="text-xs text-muted-foreground">
                  Use rows for Sage divisions, cost codes, alternates, or quote
                  sections. Drag the handle or use the arrows to reorder.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <SortByCostCodeButton
                  label="scope rows"
                  disabled={lines.length < 2}
                  onSort={() => setLines((current) => sortLinesByCostCode(current, (line) => line.costCode))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLine}
                >
                  <IconPlus className="size-4" />
                  Add row
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1100px]">
                <div className="grid grid-cols-[2.75rem_2rem_minmax(14rem,1fr)_11rem_16rem_minmax(10rem,.8fr)_2.5rem] gap-2 border-b py-2 text-xs font-medium text-muted-foreground">
                  <span />
                  <span>#</span>
                  <span>Description</span>
                  <span>Division</span>
                  <span>Cost code</span>
                  <span>Notes</span>
                  <span />
                </div>
                <SortableRows ids={lines.map((line) => line.id)} onMove={(from, to) => setLines((current) => moveLine(current, from, to))}>
                {lines.map((line, index) => (
                  <SortableRow
                    key={line.id}
                    id={line.id}
                    index={index}
                    className="grid grid-cols-[2.75rem_2rem_minmax(14rem,1fr)_11rem_16rem_minmax(10rem,.8fr)_2.5rem] gap-2 border-b bg-background py-2 last:border-b-0"
                  >
                    <div className="pt-0.5">
                      <ReorderHandle label={`scope row ${index + 1}`} />
                    </div>
                    <span className="pt-2 text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <Input
                      value={line.description}
                      onChange={(event) =>
                        updateLine(line.id, "description", event.target.value)
                      }
                      placeholder="Scope item"
                      className={LINE_INPUT_CLASS}
                    />
                    <ProjectRfqDivisionPicker
                      value={line.phaseCode}
                      options={costCodeOptions}
                      rowNumber={index + 1}
                      onValueChange={(value) =>
                        updateLineDivision(line.id, value)
                      }
                    />
                    <ProjectRfqCostCodePicker
                      value={line.costCode}
                      options={costCodeOptions}
                      divisionCode={line.phaseCode}
                      rowNumber={index + 1}
                      onValueChange={(value) =>
                        updateLineCostCode(line.id, value)
                      }
                    />
                    <Input
                      value={line.notes}
                      onChange={(event) =>
                        updateLine(line.id, "notes", event.target.value)
                      }
                      placeholder="Alternate, allowance, detail"
                      className={LINE_INPUT_CLASS}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      disabled={lines.length === 1}
                      onClick={() => removeLine(line.id)}
                      aria-label={`Remove scope row ${index + 1}`}
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  </SortableRow>
                ))}
                </SortableRows>
              </div>
            </div>
          </div>
  )
}
