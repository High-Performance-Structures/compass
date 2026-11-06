"use client"

import * as React from "react"
import { IconArrowDown, IconArrowUp, IconGripVertical, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deleteCompanyRecordStatus,
  getRecordStatusSettings,
  saveRecordStatuses,
  type RecordStatusSettingsView,
} from "@/app/actions/record-statuses"
import { RecordStatusBadge, RecordStatusDot } from "@/components/record-status-badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RECORD_STATUS_LABEL_MAX, type RecordStatusEdit } from "@/lib/domain/record-statuses/rules"
import {
  RECORD_STATUS_COLORS,
  RECORD_STATUS_GROUPS,
  type RecordStatusColor,
  type RecordStatusGroup,
  type RecordStatusType,
} from "@/lib/domain/record-statuses/statuses"
import { isListValue } from "@/lib/shared/statuses"
import { cn } from "@/lib/utils"

type TypeList = RecordStatusSettingsView["lists"][number]

/** One row being edited. `id` is local only; `key` is null until a new status is saved. */
type DraftRow = RecordStatusEdit & { readonly id: string; readonly builtIn: boolean }

const COLOR_LABELS: Readonly<Record<RecordStatusColor, string>> = {
  gray: "Gray",
  blue: "Blue",
  green: "Green",
  orange: "Orange",
  red: "Red",
}

const GROUP_LABELS: Readonly<Record<RecordStatusGroup, string>> = { open: "Open", closed: "Closed", void: "Void" }

function draftRows(list: TypeList): readonly DraftRow[] {
  return list.statuses.map((status) => ({
    id: status.key,
    key: status.key,
    label: status.label,
    color: status.color,
    group: status.group,
    showAsButton: status.showAsButton,
    hidden: status.hidden,
    builtIn: status.builtIn,
  }))
}

function moved<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (to < 0 || to >= items.length || from === to) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

function sameRows(a: readonly DraftRow[], b: readonly DraftRow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The filter buttons this list would show: Open, each shown status, then All. */
function FilterPreview({ rows }: { readonly rows: readonly DraftRow[] }): React.ReactElement {
  const shown = rows.filter((row) => row.showAsButton && !row.hidden)
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Preview of filter buttons</p>
      <div className="flex flex-wrap gap-1" aria-label="Preview of filter buttons">
        <Button type="button" size="sm" variant="secondary" tabIndex={-1}>
          Open
        </Button>
        {shown.map((row) => (
          <Button key={row.id} type="button" size="sm" variant="ghost" tabIndex={-1}>
            <RecordStatusDot color={row.color} />
            {row.label.trim() || "Untitled"}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" tabIndex={-1}>
          All
        </Button>
      </div>
    </div>
  )
}

function StatusRow({
  row,
  index,
  count,
  canEdit,
  onChange,
  onMove,
  onDelete,
  onDragStart,
  onDrop,
}: {
  readonly row: DraftRow
  readonly index: number
  readonly count: number
  readonly canEdit: boolean
  readonly onChange: (patch: Partial<RecordStatusEdit>) => void
  readonly onMove: (to: number) => void
  readonly onDelete: () => void
  readonly onDragStart: () => void
  readonly onDrop: () => void
}): React.ReactElement {
  const name = row.label.trim() || "this status"
  return (
    <tr
      className={cn("border-b align-middle", row.hidden && "text-muted-foreground")}
      onDragOver={(event) => {
        if (canEdit) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
    >
      <td className="py-2 pr-2">
        <div className="flex items-center gap-0.5">
          <span
            draggable={canEdit}
            onDragStart={onDragStart}
            className={cn("text-muted-foreground", canEdit && "cursor-grab")}
            aria-hidden
          >
            <IconGripVertical className="size-4" />
          </span>
          <Button type="button" variant="ghost" size="icon" className="size-7" disabled={!canEdit || index === 0}
            aria-label={`Move ${name} up`} onClick={() => onMove(index - 1)}>
            <IconArrowUp className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-7" disabled={!canEdit || index === count - 1}
            aria-label={`Move ${name} down`} onClick={() => onMove(index + 1)}>
            <IconArrowDown className="size-4" />
          </Button>
        </div>
      </td>
      <td className="py-2 pr-2">
        <div className="flex min-w-44 items-center gap-2">
          <Input
            value={row.label}
            maxLength={RECORD_STATUS_LABEL_MAX}
            disabled={!canEdit}
            aria-label="Status name"
            placeholder="Status name"
            className="h-8"
            onChange={(event) => onChange({ label: event.target.value })}
          />
          {row.builtIn && <span className="shrink-0 text-xs text-muted-foreground">Built-in</span>}
        </div>
      </td>
      <td className="py-2 pr-2">
        <Select value={row.color} disabled={!canEdit}
          onValueChange={(value) => { if (isListValue(RECORD_STATUS_COLORS, value)) onChange({ color: value }) }}>
          <SelectTrigger size="sm" className="w-32" aria-label={`Color for ${name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECORD_STATUS_COLORS.map((color) => (
              <SelectItem key={color} value={color}>
                <RecordStatusDot color={color} />
                {COLOR_LABELS[color]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-2 pr-2">
        <Select value={row.group} disabled={!canEdit}
          onValueChange={(value) => { if (isListValue(RECORD_STATUS_GROUPS, value)) onChange({ group: value }) }}>
          <SelectTrigger size="sm" className="w-28" aria-label={`What ${name} counts as`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECORD_STATUS_GROUPS.map((group) => (
              <SelectItem key={group} value={group}>{GROUP_LABELS[group]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-2 pr-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={row.showAsButton} disabled={!canEdit || row.hidden}
            onCheckedChange={(checked) => onChange({ showAsButton: checked === true })} />
          Show
        </label>
      </td>
      <td className="py-2 text-right">
        {row.builtIn || row.hidden ? (
          <Button type="button" variant="ghost" size="sm" disabled={!canEdit} onClick={() => onChange({ hidden: !row.hidden })}>
            {row.hidden ? "Show" : "Hide"}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={!canEdit} onClick={onDelete}>
            Delete
          </Button>
        )}
      </td>
    </tr>
  )
}

/**
 * Settings › Statuses: each record type's statuses, in the order they appear
 * on filter buttons and in sorting. Built-in statuses can be renamed,
 * recolored, regrouped, reordered or hidden; company statuses can also be
 * deleted while no record uses them.
 */
export function RecordStatusesTab(): React.ReactElement {
  const [view, setView] = React.useState<RecordStatusSettingsView | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [type, setType] = React.useState<RecordStatusType>("purchase_order")
  const [rows, setRows] = React.useState<readonly DraftRow[]>([])
  const [saving, setSaving] = React.useState(false)
  const [notice, setNotice] = React.useState<{ readonly rowId: string; readonly message: string } | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<DraftRow | null>(null)
  const dragFrom = React.useRef<number | null>(null)

  const load = React.useCallback(async (): Promise<void> => {
    const result = await getRecordStatusSettings()
    if (!result.success) {
      setLoadError(result.error)
      return
    }
    setLoadError(null)
    setView(result.data)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const list = view?.lists.find((item) => item.type === type) ?? null
  const savedRows = React.useMemo(() => (list ? draftRows(list) : []), [list])
  React.useEffect(() => {
    setRows(savedRows)
    setNotice(null)
  }, [savedRows])
  const dirty = !sameRows(rows, savedRows)
  const canEdit = view?.canEdit === true && !saving

  const update = (id: string, patch: Partial<RecordStatusEdit>): void => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const chooseType = (next: RecordStatusType): void => {
    if (next === type) return
    if (dirty && !window.confirm("Discard your unsaved status changes?")) return
    setType(next)
  }

  const add = (): void => {
    setRows((current) => [
      ...current,
      { id: crypto.randomUUID(), key: null, label: "", color: "gray", group: "open", showAsButton: true, hidden: false, builtIn: false },
    ])
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    const result = await saveRecordStatuses(
      type,
      rows.map(({ key, label, color, group, showAsButton, hidden }) => ({ key, label, color, group, showAsButton, hidden })),
    )
    setSaving(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success(`${list?.label ?? "Statuses"} saved`)
    await load()
  }

  const requestDelete = (row: DraftRow): void => {
    setNotice(null)
    // A status not saved yet is only in this list.
    if (row.key === null) {
      setRows((current) => current.filter((item) => item.id !== row.id))
      return
    }
    if (dirty) {
      toast.error("Save or discard your other changes before deleting a status.")
      return
    }
    setPendingDelete(row)
  }

  const confirmDelete = async (): Promise<void> => {
    const row = pendingDelete
    setPendingDelete(null)
    if (!row?.key) return
    setSaving(true)
    const result = await deleteCompanyRecordStatus(type, row.key)
    setSaving(false)
    if (!result.success) {
      // In use (or built-in): offer Hide instead, with the server's reason.
      setNotice({ rowId: row.id, message: result.error })
      return
    }
    toast.success(`${row.label} deleted`)
    await load()
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>
  if (!view || !list) return <p className="text-sm text-muted-foreground">Loading statuses…</p>

  const noticeRow = notice ? rows.find((row) => row.id === notice.rowId) : undefined

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Statuses</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each record type&apos;s statuses, in the order they appear on filter buttons and in sorting.
          &ldquo;Counts as&rdquo; decides what the Open button shows.
        </p>
        {!view.canEdit && (
          <p className="mt-2 text-sm text-muted-foreground">Only admins can change company statuses.</p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Record types" className="flex flex-wrap gap-1 md:flex-col">
          {view.lists.map((item) => (
            <Button
              key={item.type}
              type="button"
              variant={item.type === type ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              aria-current={item.type === type ? "page" : undefined}
              onClick={() => chooseType(item.type)}
            >
              {item.label}
            </Button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Move</th>
                  <th className="py-2 pr-2 font-medium">Name</th>
                  <th className="py-2 pr-2 font-medium">Color</th>
                  <th className="py-2 pr-2 font-medium">Counts as</th>
                  <th className="py-2 pr-2 font-medium">Filter button</th>
                  <th className="py-2 font-medium"><span className="sr-only">Hide or delete</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <StatusRow
                    key={row.id}
                    row={row}
                    index={index}
                    count={rows.length}
                    canEdit={canEdit}
                    onChange={(patch) => update(row.id, patch)}
                    onMove={(to) => setRows((current) => moved(current, index, to))}
                    onDelete={() => requestDelete(row)}
                    onDragStart={() => {
                      dragFrom.current = index
                    }}
                    onDrop={() => {
                      const from = dragFrom.current
                      dragFrom.current = null
                      if (from !== null) setRows((current) => moved(current, from, index))
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {notice && noticeRow && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
              <span>{notice.message}</span>
              <Button type="button" size="sm" variant="outline" disabled={!canEdit}
                onClick={() => { update(noticeRow.id, { hidden: true }); setNotice(null) }}>
                Hide {noticeRow.label}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={add}>
              <IconPlus className="size-4" />
              Add status
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => setRows(savedRows)}>
                Discard changes
              </Button>
              <Button type="button" size="sm" disabled={!dirty || !canEdit} onClick={() => void save()}>
                {saving ? "Saving…" : "Save statuses"}
              </Button>
            </div>
          </div>

          <FilterPreview rows={rows} />

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Badges</p>
            <div className="flex flex-wrap gap-1">
              {rows.filter((row) => !row.hidden).map((row) => (
                <RecordStatusBadge key={row.id} label={row.label.trim() || "Untitled"} color={row.color} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It leaves this list for good. A status that any record still uses can&apos;t be deleted; hide it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
