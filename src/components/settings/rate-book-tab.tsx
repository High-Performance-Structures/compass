"use client"

import * as React from "react"
import {
  createRateBookEntry,
  deleteRateBookEntry,
  getRateBookHistory,
  listRateBookEntries,
  setRateBookEntryStatus,
  updateRateBookEntry,
  type RateBookEntry,
  type RateBookHistoryItem,
} from "@/app/actions/rate-book"
import { SearchableCombobox } from "@/components/searchable-combobox"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { projectEstimateCostCodeCatalog } from "@/lib/estimates/project-cost-code-catalog"
import {
  formatCents,
  formatMarkup,
  RATE_BOOK_CATEGORIES,
  RATE_BOOK_CATEGORY_LABEL,
  RATE_BOOK_UNITS,
  type RateBookCategory,
  type RateBookEntryInput,
} from "@/lib/rate-book/model"
import { cn } from "@/lib/utils"

const ALL = "all"
const NO_CODE = "none"

type Draft = {
  readonly name: string
  readonly category: RateBookCategory
  readonly unit: string
  readonly unitCost: string
  readonly markup: string
  readonly costCode: string
  readonly fuelType: "none" | "diesel" | "regular"
  readonly fuelGallons: string
  readonly notes: string
  readonly changeNote: string
}

const EMPTY_DRAFT: Draft = {
  name: "",
  category: "labor",
  unit: "hr",
  unitCost: "",
  markup: "0",
  costCode: NO_CODE,
  fuelType: "none",
  fuelGallons: "",
  notes: "",
  changeNote: "",
}

function draftFrom(entry: RateBookEntry): Draft {
  return {
    name: entry.name,
    category: entry.category,
    unit: entry.unit,
    unitCost: (entry.unitCostCents / 100).toFixed(2),
    markup: String(entry.markupBasisPoints / 100),
    costCode: entry.costCode ?? NO_CODE,
    fuelType: entry.fuelType,
    fuelGallons: entry.fuelGallonsPerUnit === null ? "" : String(entry.fuelGallonsPerUnit),
    notes: entry.notes ?? "",
    changeNote: "",
  }
}

type CostCodeOption = {
  readonly code: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionDescription: string
  readonly displayLabel: string
}

function inputFrom(draft: Draft, codes: ReadonlyMap<string, CostCodeOption>): RateBookEntryInput | string {
  const unitCost = Number(draft.unitCost)
  const markup = Number(draft.markup || "0")
  const gallons = draft.fuelGallons.trim() ? Number(draft.fuelGallons) : null
  if (!draft.unitCost.trim() || !Number.isFinite(unitCost) || unitCost < 0) return "Enter the cost as a number, like 125.00."
  if (!Number.isFinite(markup) || markup < 0) return "Enter the markup as a percent, like 15."
  if (gallons !== null && (!Number.isFinite(gallons) || gallons < 0)) return "Enter fuel use as gallons, like 3.5."
  const code = draft.costCode === NO_CODE ? undefined : codes.get(draft.costCode)
  return {
    name: draft.name,
    category: draft.category,
    unit: draft.unit,
    unitCostCents: Math.round(unitCost * 100),
    markupBasisPoints: Math.round(markup * 100),
    divisionCode: code?.divisionCode ?? null,
    divisionName: code?.divisionDescription ?? null,
    costCode: code?.code ?? null,
    costCodeName: code?.description ?? null,
    fuelType: draft.fuelType,
    fuelGallonsPerUnit: draft.fuelType === "none" ? null : gallons,
    notes: draft.notes,
  }
}

/**
 * Settings → Rate book: accepted rates estimators pick from. Every save keeps
 * the previous values in the history; used rates are retired, not deleted.
 */
export function RateBookTab(): React.ReactElement {
  const [entries, setEntries] = React.useState<readonly RateBookEntry[] | null>(null)
  const [canEdit, setCanEdit] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [category, setCategory] = React.useState<string>(ALL)
  const [showRetired, setShowRetired] = React.useState(false)
  const [editing, setEditing] = React.useState<RateBookEntry | "new" | null>(null)

  const codeOptions = React.useMemo<readonly CostCodeOption[]>(
    () => projectEstimateCostCodeCatalog([], []).map((item) => ({
      code: item.code,
      description: item.description,
      divisionCode: item.divisionCode,
      divisionDescription: item.divisionDescription,
      displayLabel: item.displayLabel,
    })),
    [],
  )
  const codesByCode = React.useMemo(() => new Map(codeOptions.map((option) => [option.code, option])), [codeOptions])

  const load = React.useCallback(async (): Promise<void> => {
    const result = await listRateBookEntries()
    if (result.success) {
      setEntries(result.data.entries)
      setCanEdit(result.data.canEdit)
      setError(null)
    } else {
      setError(result.error)
      setEntries([])
    }
  }, [])
  React.useEffect(() => {
    void load()
  }, [load])

  const query = search.trim().toLowerCase()
  const visible = (entries ?? []).filter((entry) =>
    (showRetired || entry.status === "active") &&
    (category === ALL || entry.category === category) &&
    (!query || `${entry.name} ${entry.costCode ?? ""} ${entry.costCodeName ?? ""} ${entry.notes ?? ""}`.toLowerCase().includes(query)),
  )
  const activeCount = (entries ?? []).filter((entry) => entry.status === "active").length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-base font-semibold">Rate book</h2>
          <span className="text-xs text-muted-foreground">{activeCount} active</span>
        </div>
        {canEdit ? <Button size="sm" onClick={() => setEditing("new")}>Add rate</Button> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search rates"
          placeholder="Search name, cost code or notes"
          className="h-9 max-w-xs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Category" className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {RATE_BOOK_CATEGORIES.map((value) => (
              <SelectItem key={value} value={value}>{RATE_BOOK_CATEGORY_LABEL[value]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showRetired} onCheckedChange={setShowRetired} aria-label="Show retired rates" />
          Show retired
        </label>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {entries === null ? (
        <p className="text-sm text-muted-foreground">Loading rates…</p>
      ) : visible.length === 0 ? (
        <p className="border-y py-8 text-center text-sm text-muted-foreground">
          {entries.length === 0
            ? canEdit
              ? "No rates yet. Add the rates your estimators use most, like machine hours, delivery and travel."
              : "No rates have been added yet."
            : "No rates match these filters."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Rate</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 text-right font-medium">Cost</th>
                <th className="py-2 pr-3 text-right font-medium">Markup</th>
                <th className="py-2 pr-3 font-medium">Cost code</th>
                <th className="py-2 text-right font-medium">Used</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr
                  key={entry.id}
                  className={cn("cursor-pointer border-b hover:bg-muted/40", entry.status === "retired" && "text-muted-foreground")}
                  onClick={() => setEditing(entry)}
                >
                  <td className="py-2 pr-3">
                    <button type="button" className="text-left font-medium hover:underline" onClick={(event) => {
                      event.stopPropagation()
                      setEditing(entry)
                    }}>
                      {entry.name}
                    </button>
                    {entry.status === "retired" ? <span className="ml-2 text-xs">Retired</span> : null}
                    {entry.notes ? <span className="block max-w-md truncate text-xs text-muted-foreground">{entry.notes}</span> : null}
                  </td>
                  <td className="py-2 pr-3">{RATE_BOOK_CATEGORY_LABEL[entry.category]}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatCents(entry.unitCostCents)}/{entry.unit}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatMarkup(entry.markupBasisPoints)}</td>
                  <td className="py-2 pr-3 text-xs">{entry.costCode ? `${entry.costCode} ${entry.costCodeName ?? ""}` : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{entry.usageCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? (
        <RateEditor
          entry={editing === "new" ? null : editing}
          canEdit={canEdit}
          codeOptions={codeOptions}
          codesByCode={codesByCode}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}

function RateEditor({
  entry,
  canEdit,
  codeOptions,
  codesByCode,
  onClose,
  onSaved,
}: {
  readonly entry: RateBookEntry | null
  readonly canEdit: boolean
  readonly codeOptions: readonly CostCodeOption[]
  readonly codesByCode: ReadonlyMap<string, CostCodeOption>
  readonly onClose: () => void
  readonly onSaved: () => void
}): React.ReactElement {
  const [draft, setDraft] = React.useState<Draft>(() => (entry ? draftFrom(entry) : EMPTY_DRAFT))
  const [message, setMessage] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const [history, setHistory] = React.useState<readonly RateBookHistoryItem[] | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const update = (next: Partial<Draft>): void => setDraft((current) => ({ ...current, ...next }))
  const readOnly = !canEdit || pending

  React.useEffect(() => {
    if (!entry) return
    void getRateBookHistory(entry.id).then((result) => setHistory(result.success ? result.data : []))
  }, [entry])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const input = inputFrom(draft, codesByCode)
    if (typeof input === "string") {
      setMessage(input)
      return
    }
    startTransition(async () => {
      const result = entry
        ? await updateRateBookEntry(entry.id, input, draft.changeNote)
        : await createRateBookEntry(input)
      if (result.success) onSaved()
      else setMessage(result.error)
    })
  }

  function setStatus(status: "active" | "retired"): void {
    if (!entry) return
    startTransition(async () => {
      const result = await setRateBookEntryStatus(entry.id, status)
      if (result.success) onSaved()
      else setMessage(result.error)
    })
  }

  function remove(): void {
    if (!entry) return
    setConfirmDelete(false)
    startTransition(async () => {
      const result = await deleteRateBookEntry(entry.id)
      if (result.success) onSaved()
      else setMessage(result.error)
    })
  }

  const codeSelectOptions = React.useMemo(
    () => [
      { value: NO_CODE, label: "No cost code" },
      ...codeOptions.map((option) => ({ value: option.code, label: option.displayLabel, keywords: option.divisionDescription })),
    ],
    [codeOptions],
  )

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? (canEdit ? "Edit rate" : entry.name) : "Add rate"}</DialogTitle>
        </DialogHeader>
        <form id="rate-book-form" className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rate-name">Name</Label>
            <Input id="rate-name" value={draft.name} disabled={readOnly} maxLength={120}
              placeholder="For example: Komatsu PC88 excavator with operator"
              onChange={(event) => update({ name: event.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-category">Category</Label>
            <Select value={draft.category} disabled={readOnly} onValueChange={(value) => {
              const next = RATE_BOOK_CATEGORIES.find((item) => item === value)
              if (next) update({ category: next })
            }}>
              <SelectTrigger id="rate-category" className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RATE_BOOK_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>{RATE_BOOK_CATEGORY_LABEL[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-unit">Unit</Label>
            <Input id="rate-unit" list="rate-book-units" value={draft.unit} disabled={readOnly} maxLength={20}
              onChange={(event) => update({ unit: event.target.value })} required />
            <datalist id="rate-book-units">
              {RATE_BOOK_UNITS.map((unit) => <option key={unit} value={unit} />)}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-cost">Cost per unit ($)</Label>
            <Input id="rate-cost" inputMode="decimal" value={draft.unitCost} disabled={readOnly}
              onChange={(event) => update({ unitCost: event.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-markup">Default markup (%)</Label>
            <Input id="rate-markup" inputMode="decimal" value={draft.markup} disabled={readOnly}
              onChange={(event) => update({ markup: event.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rate-cost-code">Cost code</Label>
            <SearchableCombobox
              id="rate-cost-code"
              className="h-9"
              value={draft.costCode}
              onValueChange={(value) => {
                // The picker reports "" when it resets; keep the current choice.
                if (value) update({ costCode: value })
              }}
              options={codeSelectOptions}
              ariaLabel="Cost code"
              placeholder="No cost code"
              searchPlaceholder="Search cost codes..."
              emptyMessage="No matching cost codes."
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-fuel">Fuel</Label>
            <Select value={draft.fuelType} disabled={readOnly} onValueChange={(value) => {
              if (value === "none" || value === "diesel" || value === "regular") update({ fuelType: value })
            }}>
              <SelectTrigger id="rate-fuel" className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No fuel in this rate</SelectItem>
                <SelectItem value="diesel">Diesel</SelectItem>
                <SelectItem value="regular">Regular gasoline</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-gallons">Fuel per unit (gal)</Label>
            <Input id="rate-gallons" inputMode="decimal" value={draft.fuelGallons}
              disabled={readOnly || draft.fuelType === "none"}
              placeholder={draft.fuelType === "none" ? "—" : "For example: 3.5"}
              onChange={(event) => update({ fuelGallons: event.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rate-notes">Notes</Label>
            <Textarea id="rate-notes" rows={2} maxLength={1000} value={draft.notes} disabled={readOnly}
              placeholder="What the rate includes, minimums, when to use it"
              onChange={(event) => update({ notes: event.target.value })} />
          </div>
          {entry && canEdit ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rate-change-note">Reason for change (optional)</Label>
              <Input id="rate-change-note" maxLength={300} value={draft.changeNote} disabled={pending}
                placeholder="For example: diesel up 8% in September"
                onChange={(event) => update({ changeNote: event.target.value })} />
            </div>
          ) : null}
        </form>
        {message ? <p className="text-sm text-destructive" role="status">{message}</p> : null}
        {entry ? (
          <section className="border-t pt-3" aria-label="Rate history">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h3>
            {history === null ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : history.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <ul className="mt-2 divide-y text-sm">
                {history.map((item) => (
                  <li key={`${item.version}-${item.changedAt}`} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                    <span>
                      <span className="tabular-nums">{formatCents(item.snapshot.unitCostCents)}/{item.snapshot.unit}</span>
                      <span className="text-muted-foreground"> · {formatMarkup(item.snapshot.markupBasisPoints)} markup</span>
                      {item.changeNote ? <span className="text-muted-foreground"> · {item.changeNote}</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.changedAt).toLocaleDateString()} {item.changedByName ? `· ${item.changedByName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {entry && canEdit ? (
              entry.status === "active" ? (
                <Button type="button" variant="outline" disabled={pending} onClick={() => setStatus("retired")}>Retire</Button>
              ) : (
                <Button type="button" variant="outline" disabled={pending} onClick={() => setStatus("active")}>Restore</Button>
              )
            ) : null}
            {entry && canEdit && entry.usageCount === 0 ? (
              <Button type="button" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</Button>
            {canEdit ? <Button type="submit" form="rate-book-form" disabled={pending}>{entry ? "Save" : "Add rate"}</Button> : null}
          </div>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rate?</AlertDialogTitle>
            <AlertDialogDescription>
              No estimate uses it, so it and its history will be removed permanently. To keep it on record instead, retire it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep rate</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete rate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
