"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { DEPENDENCY_TYPES, predecessorPickerOptions } from "./form-model"
import type { PredecessorEditsState } from "./use-predecessor-edits"

/** Saved and new predecessors with relationship and lag. */
export function PredecessorsEditor({
  predecessors,
}: {
  readonly predecessors: PredecessorEditsState
}) {
  const {
    existingPredecessors,
    availableTasks,
    pendingPredecessors,
    existingPredecessorEdits,
    addPendingPredecessor,
    removePendingPredecessor,
    updatePendingPredecessor,
    updateExistingPredecessor,
    handleDeleteExistingDep,
  } = predecessors
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">
          Predecessors
        </h3>
        <ContextualHelpBeacon topicId="schedule.predecessors" />
      </div>

      {existingPredecessors.map((dep) => {
        const edit = existingPredecessorEdits[dep.id] ?? {
          taskId: dep.predecessorId,
          type: dep.type,
          lagDays: dep.lagDays
        }
        return (
          <div
            key={dep.id}
            className="space-y-2 border-b border-border/70 pb-3 last:border-b-0 last:pb-0"
          >
            <SearchableCombobox
              className="h-9 text-xs"
              value={edit.taskId}
              // Ignore the picker's reset so a saved dependency is never blanked.
              onValueChange={(value) => {
                if (value !== "") updateExistingPredecessor(dep.id, "taskId", value)
              }}
              options={predecessorPickerOptions(availableTasks)}
              ariaLabel="Saved predecessor schedule item"
              placeholder="Select schedule item"
              searchPlaceholder="Search schedule items..."
              emptyMessage="No matching schedule items."
            />
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-end gap-2">
              <div className="min-w-0 space-y-1">
                <span className="block text-xs text-muted-foreground">
                  Relationship
                </span>
                <Select
                  value={edit.type}
                  onValueChange={(value) =>
                    updateExistingPredecessor(dep.id, "type", value)
                  }
                >
                  <SelectTrigger
                    className="h-9 w-full min-w-0 text-xs [&_[data-slot=select-value]]:truncate"
                    aria-label="Saved dependency relationship"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPENDENCY_TYPES.map((dependencyType) => (
                      <SelectItem
                        key={dependencyType.value}
                        value={dependencyType.value}
                      >
                        {dependencyType.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1">
                <span className="block text-xs text-muted-foreground">
                  Lag / lead days
                </span>
                <Input
                  type="number"
                  className="h-9 min-w-0 text-center text-xs"
                  value={edit.lagDays}
                  aria-label="Saved dependency lag or lead in days"
                  onChange={(event) =>
                    updateExistingPredecessor(
                      dep.id,
                      "lagDays",
                      Number(event.target.value) || 0
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mb-0.5 size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDeleteExistingDep(dep.id)}
                aria-label="Remove saved predecessor"
                title="Remove predecessor"
              >
                <IconTrash className="size-3" />
              </Button>
            </div>
          </div>
        )
      })}

      {pendingPredecessors.map((pred, idx) => (
        <div
          key={idx}
          className="space-y-2 border-b border-border/70 pb-3 last:border-b-0 last:pb-0"
        >
          <SearchableCombobox
            className="h-9 text-xs"
            value={pred.taskId}
            onValueChange={(val) => {
              if (val !== "") updatePendingPredecessor(idx, "taskId", val)
            }}
            options={predecessorPickerOptions(availableTasks)}
            ariaLabel="Predecessor schedule item"
            placeholder="Select schedule item"
            searchPlaceholder="Search schedule items..."
            emptyMessage="No matching schedule items."
          />
          <div className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-end gap-2">
            <div className="min-w-0 space-y-1">
              <span className="block text-xs text-muted-foreground">
                Relationship
              </span>
              <Select
                value={pred.type}
                onValueChange={(val) => updatePendingPredecessor(idx, "type", val)}
              >
                <SelectTrigger
                  className="h-9 w-full min-w-0 text-xs [&_[data-slot=select-value]]:truncate"
                  aria-label="Dependency relationship"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPENDENCY_TYPES.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <span className="block text-xs text-muted-foreground">
                Lag / lead days
              </span>
              <Input
                type="number"
                className="h-9 min-w-0 text-center text-xs"
                value={pred.lagDays || ""}
                aria-label="Lag or lead in days"
                onChange={(e) =>
                  updatePendingPredecessor(
                    idx,
                    "lagDays",
                    Number(e.target.value) || 0
                  )
                }
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mb-0.5 size-8 text-muted-foreground hover:text-destructive"
              onClick={() => removePendingPredecessor(idx)}
              aria-label="Remove predecessor"
              title="Remove predecessor"
            >
              <IconTrash className="size-3" />
            </Button>
          </div>
        </div>
      ))}

      {availableTasks.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground h-7 px-2"
          onClick={addPendingPredecessor}
        >
          <IconPlus className="size-3 mr-1" />
          Add
        </Button>
      )}

      {availableTasks.length === 0 && existingPredecessors.length === 0 && (
        <p className="text-xs text-muted-foreground/60">
          No other schedule items to link as predecessors.
        </p>
      )}
    </div>
  )
}
