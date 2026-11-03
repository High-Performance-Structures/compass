"use client"

import { IconPlus, IconTrash } from "@tabler/icons-react"

import type { ProjectRfqCostCodeOption } from "@/lib/domain/operations/types"
import {
  ProjectRfqCostCodePicker,
  ProjectRfqDivisionPicker,
} from "@/components/projects/project-rfq-cost-code-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { LINE_INPUT_CLASS } from "./rfq-draft"
import type { RfqRowsState } from "./use-rfq-create-draft"

/** "Scope rows": description, Sage division and cost code, and notes. */
export function RfqScopeRows({
  rows,
  costCodeOptions,
}: {
  readonly rows: RfqRowsState
  readonly costCodeOptions: readonly ProjectRfqCostCodeOption[]
}): React.ReactElement {
  const {
    lines,
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
                  sections.
                </p>
              </div>
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
            <div className="overflow-x-auto">
              <div className="min-w-[1050px]">
                <div className="grid grid-cols-[2rem_minmax(14rem,1fr)_11rem_16rem_minmax(10rem,.8fr)_2.5rem] gap-2 border-b py-2 text-xs font-medium text-muted-foreground">
                  <span>#</span>
                  <span>Description</span>
                  <span>Division</span>
                  <span>Cost code</span>
                  <span>Notes</span>
                  <span />
                </div>
                {lines.map((line, index) => (
                  <div
                    key={line.id}
                    className="grid grid-cols-[2rem_minmax(14rem,1fr)_11rem_16rem_minmax(10rem,.8fr)_2.5rem] gap-2 border-b py-2 last:border-b-0"
                  >
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
                  </div>
                ))}
              </div>
            </div>
          </div>
  )
}
