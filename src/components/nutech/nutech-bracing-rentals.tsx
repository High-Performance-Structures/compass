"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import {
  deleteBracingRental,
  saveBracingRental,
  type BracingRentalInput,
  type BracingRentalView,
  type ProjectBracingRentals,
} from "@/app/actions/nutech-bracing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { BracingRentalSettings } from "@/lib/feature-settings/registry"
import { DOCUMENT_INPUT_CLASS, DOCUMENT_SELECT_TRIGGER_CLASS, DOCUMENT_TEXTAREA_CLASS } from "@/lib/ui/document-fields"
import { cn } from "@/lib/utils"
import { bracingCharges, bracingRentalDays, bracingSignOutIssues } from "@/lib/nutech/bracing"
import { formatCents } from "@/lib/format"

type LineDraft = {
  readonly key: string
  readonly itemKey: string
  readonly size: string
  readonly quantityOut: string
  readonly quantityReturned: string
  readonly quantityDamaged: string
  readonly damage: string
  readonly damageNote: string
}

type Draft = {
  readonly signedOutOn: string
  readonly expectedReturnOn: string
  readonly returnedOn: string
  readonly billedDays: string
  readonly deposit: string
  readonly idCopyReceived: boolean
  readonly notes: string
  readonly lines: readonly LineDraft[]
}

const NO_SIZE = "none"
const STATUS_LABEL = { reserved: "Reserved", out: "Out on the job", returned: "Returned" } as const

function count(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function cents(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[$,]/g, ""))
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0
}

function dollars(value: number): string {
  return value > 0 ? (value / 100).toFixed(2) : ""
}

/** Today in the viewer's time zone, as YYYY-MM-DD. */
function today(): string {
  return new Date().toLocaleDateString("en-CA")
}

function draftFor(rental: BracingRentalView | null, settings: BracingRentalSettings): Draft {
  const saved: readonly LineDraft[] = rental
    ? rental.lines.map((line, index) => ({
        key: `${index}`,
        itemKey: line.itemKey,
        size: line.size,
        quantityOut: line.quantityOut ? String(line.quantityOut) : "",
        quantityReturned: line.quantityReturned ? String(line.quantityReturned) : "",
        quantityDamaged: line.quantityDamaged ? String(line.quantityDamaged) : "",
        damage: dollars(line.damageCents),
        damageNote: line.damageNote,
      }))
    : []
  // Until the rental is checked in, every item stays on the form so more can go out.
  const savedKeys = new Set(saved.map((line) => line.itemKey))
  const blanks: readonly LineDraft[] =
    rental?.status === "returned"
      ? []
      : settings.items
          .filter((item) => !savedKeys.has(item.key))
          .map((item, index) => ({
            key: `new-${index}`,
            itemKey: item.key,
            size: "",
            quantityOut: "",
            quantityReturned: "",
            quantityDamaged: "",
            damage: "",
            damageNote: "",
          }))
  const lines = [...saved, ...blanks]
  return {
    signedOutOn: rental?.signedOutOn ?? "",
    expectedReturnOn: rental?.expectedReturnOn ?? "",
    returnedOn: rental?.returnedOn ?? "",
    billedDays: rental?.billedDays === null || rental?.billedDays === undefined ? "" : String(rental.billedDays),
    deposit: rental ? dollars(rental.depositCents) : "",
    idCopyReceived: rental?.idCopyReceived ?? false,
    notes: rental?.notes ?? "",
    lines,
  }
}

/** One rental: the paper rental form, sign-out to check-in. */
function RentalForm({
  projectId,
  rental,
  settings,
  canEdit,
  onDone,
}: {
  readonly projectId: string
  readonly rental: BracingRentalView | null
  readonly settings: BracingRentalSettings
  readonly canEdit: boolean
  readonly onDone: () => void
}): React.ReactElement {
  const router = useRouter()
  const [draft, setDraft] = React.useState<Draft>(() => draftFor(rental, settings))
  const [pending, startTransition] = React.useTransition()
  const status = rental?.status ?? "reserved"
  const disabled = pending || !canEdit
  const set = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }))
  const setLine = (key: string, patch: Partial<LineDraft>): void =>
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }))

  const lines = draft.lines.map((line) => ({
    itemKey: line.itemKey,
    size: line.size,
    quantityOut: count(line.quantityOut),
    quantityReturned: count(line.quantityReturned),
    quantityDamaged: count(line.quantityDamaged),
    damageCents: cents(line.damage),
  }))
  const dailyRateCents = rental?.dailyRateCents ?? settings.dailyRateCents
  const datedDays = bracingRentalDays(draft.signedOutOn || null, status === "out" ? draft.returnedOn || null : draft.returnedOn || null, today())
  const plannedDays = bracingRentalDays(draft.signedOutOn || today(), draft.expectedReturnOn || null, draft.signedOutOn || today())
  const days = draft.billedDays.trim() !== "" ? count(draft.billedDays) : status === "reserved" ? plannedDays : datedDays
  const charges = bracingCharges({ lines, billedItemKey: settings.billedItemKey, dailyRateCents, days, depositCents: cents(draft.deposit) })
  const signOutIssues =
    status === "reserved"
      ? bracingSignOutIssues({
          settings,
          idCopyReceived: draft.idCopyReceived,
          depositCents: cents(draft.deposit),
          expectedRentCents: bracingCharges({ lines, billedItemKey: settings.billedItemKey, dailyRateCents, days: Math.max(1, plannedDays), depositCents: 0 }).rentCents,
          quantityOut: lines.reduce((sum, line) => sum + line.quantityOut, 0),
        })
      : []
  const billedLabel = settings.items.find((item) => item.key === settings.billedItemKey)?.label ?? "braces"

  function submit(action: BracingRentalInput["action"]): void {
    startTransition(async () => {
      const result = await saveBracingRental({
        projectId,
        rentalId: rental?.id ?? null,
        action,
        signedOutOn: draft.signedOutOn || null,
        expectedReturnOn: draft.expectedReturnOn || null,
        returnedOn: draft.returnedOn || null,
        billedDays: draft.billedDays.trim() === "" ? null : count(draft.billedDays),
        depositCents: cents(draft.deposit),
        idCopyReceived: draft.idCopyReceived,
        notes: draft.notes,
        lines: draft.lines.map((line) => ({
          itemKey: line.itemKey,
          size: line.size,
          quantityOut: count(line.quantityOut),
          quantityReturned: count(line.quantityReturned),
          quantityDamaged: count(line.quantityDamaged),
          damageCents: cents(line.damage),
          damageNote: line.damageNote,
        })),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(action === "sign_out" ? "Bracing signed out." : action === "return" ? "Bracing checked in." : "Rental saved.")
      onDone()
      router.refresh()
    })
  }

  function remove(): void {
    if (!rental) {
      onDone()
      return
    }
    startTransition(async () => {
      const result = await deleteBracingRental(projectId, rental.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Rental deleted.")
      onDone()
      router.refresh()
    })
  }

  const idPrefix = `bracing-${rental?.id ?? "new"}`
  return (
    <div className="space-y-4 border-b pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === "out" ? "default" : "outline"}>{STATUS_LABEL[status]}</Badge>
        <span className="text-sm text-muted-foreground">
          {charges.braces} {billedLabel.toLowerCase()} × {charges.days} day{charges.days === 1 ? "" : "s"} × {formatCents(dailyRateCents)}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-out`}>Signed out</Label>
          <Input className={DOCUMENT_INPUT_CLASS} id={`${idPrefix}-out`} type="date" value={draft.signedOutOn} disabled={disabled || status === "returned"} onChange={(event) => set({ signedOutOn: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-expected`}>Expected back</Label>
          <Input className={DOCUMENT_INPUT_CLASS} id={`${idPrefix}-expected`} type="date" value={draft.expectedReturnOn} disabled={disabled} onChange={(event) => set({ expectedReturnOn: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-returned`}>Returned</Label>
          <Input className={DOCUMENT_INPUT_CLASS} id={`${idPrefix}-returned`} type="date" value={draft.returnedOn} disabled={disabled || status === "reserved"} onChange={(event) => set({ returnedOn: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-days`}>Days billed</Label>
          <Input className={DOCUMENT_INPUT_CLASS}
            id={`${idPrefix}-days`}
            inputMode="numeric"
            value={draft.billedDays}
            placeholder={`${status === "reserved" ? plannedDays : datedDays} from the dates`}
            disabled={disabled}
            onChange={(event) => set({ billedDays: event.target.value })}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Item</th>
              <th className="py-2 pr-2 font-medium">Size</th>
              <th className="py-2 pr-2 font-medium">Out</th>
              <th className="py-2 pr-2 font-medium">Returned</th>
              <th className="py-2 pr-2 font-medium">Damaged</th>
              <th className="py-2 pr-2 font-medium">Damage $</th>
              <th className="py-2 pr-2 font-medium">Damage note</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((line) => {
              const label = settings.items.find((item) => item.key === line.itemKey)?.label ?? line.itemKey
              return (
                <tr key={line.key} className="border-b">
                  <td className="py-1.5 pr-2">{label}</td>
                  <td className="w-32 py-1.5 pr-2">
                    <Select value={line.size || NO_SIZE} disabled={disabled || status === "returned"} onValueChange={(value) => setLine(line.key, { size: value === NO_SIZE ? "" : value })}>
                      <SelectTrigger aria-label={`${label} size`} className={cn(DOCUMENT_SELECT_TRIGGER_CLASS, "h-8")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SIZE}>—</SelectItem>
                        {settings.sizes.map((size) => (
                          <SelectItem key={size} value={size}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  {(["quantityOut", "quantityReturned", "quantityDamaged"] as const).map((field) => (
                    <td key={field} className="w-20 py-1.5 pr-2">
                      <Input
                        aria-label={`${label} ${field === "quantityOut" ? "out" : field === "quantityReturned" ? "returned" : "damaged"}`}
                        inputMode="numeric"
                        className={cn(DOCUMENT_INPUT_CLASS, "h-8")}
                        value={line[field]}
                        disabled={disabled || (field === "quantityOut" ? status === "returned" : status === "reserved")}
                        onChange={(event) => setLine(line.key, { [field]: event.target.value })}
                      />
                    </td>
                  ))}
                  <td className="w-24 py-1.5 pr-2">
                    <Input aria-label={`${label} damage cost`} inputMode="decimal" className={cn(DOCUMENT_INPUT_CLASS, "h-8")} value={line.damage} disabled={disabled || status === "reserved"} onChange={(event) => setLine(line.key, { damage: event.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input aria-label={`${label} damage note`} className={cn(DOCUMENT_INPUT_CLASS, "h-8")} value={line.damageNote} disabled={disabled || status === "reserved"} onChange={(event) => setLine(line.key, { damageNote: event.target.value })} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-deposit`}>Deposit paid</Label>
            <Input className={DOCUMENT_INPUT_CLASS} id={`${idPrefix}-deposit`} inputMode="decimal" placeholder="0.00" value={draft.deposit} disabled={disabled} onChange={(event) => set({ deposit: event.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={`${idPrefix}-id`} checked={draft.idCopyReceived} disabled={disabled} onCheckedChange={(checked) => set({ idCopyReceived: checked === true })} />
            <Label htmlFor={`${idPrefix}-id`}>Copy of ID received</Label>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
          <Textarea className={DOCUMENT_TEXTAREA_CLASS} id={`${idPrefix}-notes`} rows={3} value={draft.notes} disabled={disabled} onChange={(event) => set({ notes: event.target.value })} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Rent</dt>
          <dd className="tabular-nums">{formatCents(charges.rentCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Damage</dt>
          <dd className="tabular-nums">{formatCents(charges.damageCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Deposit</dt>
          <dd className="tabular-nums">−{formatCents(charges.depositCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {status === "returned"
              ? charges.balanceCents < 0
                ? "Refund due"
                : "Balance due"
              : charges.balanceCents < 0
                ? "Deposit left so far"
                : "Balance so far"}
          </dt>
          <dd className="font-semibold tabular-nums">{formatCents(Math.abs(charges.balanceCents))}</dd>
        </div>
      </dl>

      {signOutIssues.length > 0 && canEdit ? (
        <p className="border-l-2 border-warning pl-3 text-sm">Before signing out: {signOutIssues.join(" ")}</p>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {status === "reserved" ? (
            <Button type="button" size="sm" disabled={pending || signOutIssues.length > 0} onClick={() => submit("sign_out")}>
              Sign out
            </Button>
          ) : null}
          {status === "out" ? (
            <Button type="button" size="sm" disabled={pending} onClick={() => submit("return")}>
              Check in
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => submit("save")}>
            Save
          </Button>
          {status === "reserved" ? (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove}>
              <IconTrash className="size-4" />
              {rental ? "Delete" : "Cancel"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Bracing rentals on an N job: the rental form from sign-out to check-in,
 * with rent at the company's daily rate, damage, deposit and balance.
 */
export function NuTechBracingRentals({ data }: { readonly data: ProjectBracingRentals }): React.ReactElement {
  const [adding, setAdding] = React.useState(false)
  return (
    <section id="nutech-bracing" className="max-w-5xl scroll-mt-4 space-y-5 border-b pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Bracing rental</h2>
          <p className="text-sm text-muted-foreground">
            {formatCents(data.settings.dailyRateCents)} per brace per day. Equipment, sizes, rate and deposit rules are in Settings → Workflows → Bracing rentals.
          </p>
        </div>
        {data.canEdit && !adding ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <IconPlus className="size-4" />
            New rental
          </Button>
        ) : null}
      </div>
      {adding ? <RentalForm projectId={data.projectId} rental={null} settings={data.settings} canEdit={data.canEdit} onDone={() => setAdding(false)} /> : null}
      {data.rentals.map((rental) => (
        <RentalForm key={`${rental.id}-${rental.status}`} projectId={data.projectId} rental={rental} settings={data.settings} canEdit={data.canEdit} onDone={() => undefined} />
      ))}
      {data.rentals.length === 0 && !adding ? <p className="text-sm text-muted-foreground">No bracing rented on this job.</p> : null}
    </section>
  )
}
