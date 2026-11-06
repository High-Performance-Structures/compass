"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { IconArrowDown, IconArrowUp, IconColumns3, IconGripVertical } from "@tabler/icons-react"
import { toast } from "sonner"

import { resetCompanyListSheet, saveCompanyListSheet } from "@/app/actions/list-sheets"
import { useListSheetContext } from "@/components/list-sheets/list-sheet-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  LIST_SHEETS,
  listSheetSortDirectionLabels,
  type ListSheetDefinition,
} from "@/lib/domain/settings/list-sheet-registry"
import { resolveListSheetLayout, type CompanyListSheetSetting } from "@/lib/domain/settings/list-sheet-rules"
import type { ListSheetSortDirection } from "@/lib/domain/settings/statuses"
import { cn } from "@/lib/utils"

const NO_SORT = "__list-order"

type DraftColumn = { readonly id: string; readonly label: string; readonly required: boolean; readonly visible: boolean }

type Draft = {
  readonly columns: readonly DraftColumn[]
  readonly sortColumnId: string | null
  readonly sortDirection: ListSheetSortDirection
  readonly startFilter: string | null
}

function draftFor(definition: ListSheetDefinition, company: CompanyListSheetSetting | null): Draft {
  const layout = resolveListSheetLayout(definition, company, null)
  return {
    columns: layout.columns.map((column) => ({
      id: column.id,
      label: column.label,
      required: column.required === true,
      visible: column.visible,
    })),
    sortColumnId: layout.sort?.columnId ?? null,
    sortDirection: layout.sort?.desc ? "desc" : "asc",
    startFilter: layout.startFilter,
  }
}

function ColumnRow({ column, index, count, disabled, move, toggle }: {
  readonly column: DraftColumn
  readonly index: number
  readonly count: number
  readonly disabled: boolean
  readonly move: (from: number, to: number) => void
  readonly toggle: (visible: boolean) => void
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled })
  const checkboxId = React.useId()
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 border-b bg-background px-2 py-1.5 last:border-b-0", isDragging && "z-10 shadow-md")}
    >
      <div className="flex items-center">
        <Button type="button" size="icon" variant="ghost" className="size-8 touch-none cursor-grab active:cursor-grabbing"
          ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled}
          aria-label={`Drag to reorder ${column.label}`}>
          <IconGripVertical className="size-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" disabled={disabled || index === 0}
          aria-label={`Move ${column.label} up`} onClick={() => move(index, index - 1)}>
          <IconArrowUp className="size-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" disabled={disabled || index === count - 1}
          aria-label={`Move ${column.label} down`} onClick={() => move(index, index + 1)}>
          <IconArrowDown className="size-4" />
        </Button>
      </div>
      <Checkbox
        id={checkboxId}
        checked={column.visible}
        disabled={disabled || column.required}
        onCheckedChange={(checked) => toggle(checked === true)}
        aria-label={`Show ${column.label}`}
      />
      <label htmlFor={checkboxId} className="min-w-0 text-sm">
        <span className={cn("font-medium", !column.visible && "text-muted-foreground")}>{column.label}</span>
        {column.required && <span className="text-muted-foreground"> · always shown (opens the record)</span>}
      </label>
    </li>
  )
}

function SheetEditor({ definition, company, canEdit }: {
  readonly definition: ListSheetDefinition
  readonly company: CompanyListSheetSetting | null
  readonly canEdit: boolean
}): React.ReactElement {
  const router = useRouter()
  const [draft, setDraft] = React.useState(() => draftFor(definition, company))
  const [pending, startTransition] = React.useTransition()
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const disabled = !canEdit || pending
  const sortColumn = definition.columns.find((column) => column.id === draft.sortColumnId) ?? null
  const directionLabels = listSheetSortDirectionLabels(sortColumn?.kind ?? "text")

  function move(from: number, to: number): void {
    if (to < 0 || to >= draft.columns.length) return
    setDraft((current) => ({ ...current, columns: arrayMove([...current.columns], from, to) }))
  }

  function onDragEnd(event: DragEndEvent): void {
    const from = draft.columns.findIndex((column) => column.id === event.active.id)
    const to = draft.columns.findIndex((column) => column.id === event.over?.id)
    if (from >= 0 && to >= 0 && from !== to) move(from, to)
  }

  function toggle(columnId: string, visible: boolean): void {
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column) => (column.id === columnId && !column.required ? { ...column, visible } : column)),
    }))
  }

  function save(): void {
    startTransition(async () => {
      const result = await saveCompanyListSheet({
        sheetId: definition.id,
        columns: draft.columns.map(({ id, visible }) => ({ id, visible })),
        sort: draft.sortColumnId ? { columnId: draft.sortColumnId, direction: draft.sortDirection } : null,
        startFilter: definition.startFilter ? draft.startFilter : null,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${definition.label} columns saved for the company.`)
      router.refresh()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetCompanyListSheet(definition.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDraft(draftFor(definition, null))
      toast.success(`${definition.label} is back to the built-in columns.`)
      router.refresh()
    })
  }

  const preview = draft.columns.filter((column) => column.visible)
  return (
    <div className="min-w-0 space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-3 border-b px-2 pb-1.5 text-xs font-medium text-muted-foreground">
            <span className="w-24">Move</span>
            <span>Show</span>
            <span>Column</span>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
            <SortableContext items={draft.columns.map((column) => column.id)} strategy={verticalListSortingStrategy}>
              <ul aria-label={`${definition.label} columns`}>
                {draft.columns.map((column, index) => (
                  <ColumnRow
                    key={column.id}
                    column={column}
                    index={index}
                    count={draft.columns.length}
                    disabled={disabled}
                    move={move}
                    toggle={(visible) => toggle(column.id, visible)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Default sort</Label>
            <Select
              value={draft.sortColumnId ?? NO_SORT}
              disabled={disabled}
              onValueChange={(value) => setDraft((current) => ({ ...current, sortColumnId: value === NO_SORT ? null : value }))}
            >
              <SelectTrigger className="w-full" aria-label="Default sort column"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SORT}>The list&apos;s own order</SelectItem>
                {definition.columns.filter((column) => column.sortable !== false).map((column) => (
                  <SelectItem key={column.id} value={column.id}>{column.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sortColumn && (
              <Select
                value={draft.sortDirection}
                disabled={disabled}
                onValueChange={(value) => setDraft((current) => ({ ...current, sortDirection: value === "desc" ? "desc" : "asc" }))}
              >
                <SelectTrigger className="w-full" aria-label="Default sort direction"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">{directionLabels.asc}</SelectItem>
                  <SelectItem value="desc">{directionLabels.desc}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          {definition.startFilter && (
            <div className="space-y-2">
              <Label>Opens on filter</Label>
              <Select
                value={draft.startFilter ?? definition.startFilter.defaultValue}
                disabled={disabled}
                onValueChange={(value) => setDraft((current) => ({ ...current, startFilter: value }))}
              >
                <SelectTrigger className="w-full" aria-label="Opens on filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {definition.startFilter.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">A link that names a filter still opens on that filter.</p>
            </div>
          )}
          <div className="space-y-1 border-t pt-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <IconColumns3 aria-hidden className="size-4" />
              On every sheet: Columns
            </p>
            <p className="text-xs text-muted-foreground">
              Each person can hide or show columns for themselves, or reset to the company default. Their choice is saved for them only.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Preview</p>
        <div className="overflow-x-auto border-y bg-muted/50">
          <div className="flex min-w-max">
            {preview.map((column) => (
              <span key={column.id} className="whitespace-nowrap px-3 py-2 text-sm font-medium">{column.label}</span>
            ))}
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={pending}>Save</Button>
          <Button type="button" variant="outline" onClick={reset} disabled={pending || company === null}>
            Use the built-in columns
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change company list settings.</p>
      )}
    </div>
  )
}

/**
 * Settings > Lists: for every registered sheet, the columns that show, their
 * order, the default sort and the filter the sheet opens on.
 */
export function ListsTab(): React.ReactElement {
  const context = useListSheetContext()
  const [sheetId, setSheetId] = React.useState(LIST_SHEETS[0]?.id ?? "")
  const definition = LIST_SHEETS.find((sheet) => sheet.id === sheetId) ?? null
  const company = definition ? context?.preferences.company[definition.id] ?? null : null
  const canEdit = context?.preferences.canEditCompany ?? false

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Lists</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Company default columns for each sheet. People can still hide or show columns for themselves.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Sheets" className="min-w-0">
          <div className="md:hidden">
            <Select value={sheetId} onValueChange={setSheetId}>
              <SelectTrigger className="w-full" aria-label="Sheet"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIST_SHEETS.map((sheet) => <SelectItem key={sheet.id} value={sheet.id}>{sheet.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ul className="hidden space-y-0.5 md:block">
            {LIST_SHEETS.map((sheet) => {
              const active = sheet.id === sheetId
              return (
                <li key={sheet.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setSheetId(sheet.id)}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                      active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    {sheet.label}
                    <span className="block text-xs font-normal text-muted-foreground">{sheet.where}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
        {definition && (
          // A new key starts the editor fresh for each sheet and after each save.
          <SheetEditor key={`${definition.id}:${JSON.stringify(company)}`} definition={definition} company={company} canEdit={canEdit} />
        )}
      </div>
    </div>
  )
}
