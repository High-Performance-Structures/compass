"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  createShopTicket,
  deleteShopTicketDraft,
  issueShopTicket,
  updateShopTicket,
  type ShopTicketInput,
  type ShopTicketWorkspace,
} from "@/app/actions/shop-tickets"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ShopTicketSageHours, type SageHoursClaim, type SageHoursSelection } from "@/components/projects/shop-ticket-sage-hours"
import type { ShopTicketRateKind } from "@/db/schema-shop-tickets"
import type { ShopTicketWithLines } from "@/lib/shop-tickets/data"
import {
  budgetCostCodeSet,
  formatCents,
  isOutsideBudget,
  lineAmountCents,
  rateKindLabel,
  resolveShopTicketRate,
} from "@/lib/shop-tickets/model"

type EditableLine = {
  readonly key: string
  readonly costCode: string
  readonly description: string
  readonly rateKind: ShopTicketRateKind
  readonly hours: string
  /** The chosen rate book entry; null until one is chosen. */
  readonly rateBookEntryId: string | null
  /** A rate typed in for this line, in dollars; blank uses the rate book's. */
  readonly rateOverride: string
}

/** The typed-in rate in cents, or null when blank or not a number. */
function overrideCents(value: string): number | null {
  const dollars = Number.parseFloat(value)
  return value.trim() !== "" && Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : null
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function blankLine(): EditableLine {
  return { key: crypto.randomUUID(), costCode: "", description: "", rateKind: "labor", hours: "", rateBookEntryId: null, rateOverride: "" }
}

export function ShopTicketEditor({
  projectId,
  workspace,
  ticket,
  onClose,
}: {
  readonly projectId: string
  readonly workspace: ShopTicketWorkspace
  /** The draft being edited, or null for a new ticket. */
  readonly ticket: ShopTicketWithLines | null
  readonly onClose: () => void
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [ticketDate, setTicketDate] = React.useState(ticket?.ticketDate ?? today())
  const [laborFrom, setLaborFrom] = React.useState(ticket?.laborFrom ?? "")
  const [laborTo, setLaborTo] = React.useState(ticket?.laborTo ?? "")
  const [payAppNumber, setPayAppNumber] = React.useState(ticket?.payApplicationNumber?.toString() ?? "")
  const [payAppMonth, setPayAppMonth] = React.useState(ticket?.payApplicationMonth?.slice(0, 7) ?? "")
  const [notes, setNotes] = React.useState(ticket?.notes ?? "")
  const [budgetReviewed, setBudgetReviewed] = React.useState(false)
  const [lines, setLines] = React.useState<readonly EditableLine[]>(
    ticket && ticket.lines.length > 0
      ? ticket.lines.map((line) => ({
          key: line.id,
          costCode: line.costCode,
          description: line.description,
          rateKind: line.rateKind,
          hours: String(line.hours),
          rateBookEntryId: line.rateBookEntryId,
          // A saved rate that differs from the rate book's was typed in.
          rateOverride: (() => {
            const bookRate = resolveShopTicketRate(workspace.rates, line.rateKind, line.rateBookEntryId)
            return bookRate && bookRate.rateCents !== line.rateCents ? String(line.rateCents / 100) : ""
          })(),
        }))
      : [blankLine()],
  )

  // Sage timecard hours this ticket bills; null until the Sage panel has loaded them.
  const [sageClaims, setSageClaims] = React.useState<ReadonlyMap<string, SageHoursClaim> | null>(null)
  const laborCodes = new Set(lines.filter((line) => line.rateKind === "labor").map((line) => line.costCode))
  // Claims only count while the ticket still has a labor line with their cost code.
  const effectiveClaims =
    sageClaims === null
      ? null
      : new Map([...sageClaims].flatMap(([lineId, claim]) => (claim.costCode && laborCodes.has(claim.costCode) ? [[lineId, claim.hours] as const] : [])))

  const budget = React.useMemo(() => budgetCostCodeSet(workspace.budgetCostCodes), [workspace.budgetCostCodes])
  const costCodeOptions = React.useMemo(
    () =>
      workspace.costCodes.map((option) => ({
        value: option.code,
        label: `${option.code} ${option.description}`,
        keywords: option.description,
      })),
    [workspace.costCodes],
  )
  const descriptionFor = React.useMemo(
    () => new Map(workspace.costCodes.map((option) => [option.code, option.description])),
    [workspace.costCodes],
  )

  const priced = lines.map((line) => {
    const hours = Number.parseFloat(line.hours)
    const rate = resolveShopTicketRate(workspace.rates, line.rateKind, line.rateBookEntryId)
    const rateCents = overrideCents(line.rateOverride) ?? rate?.rateCents ?? null
    const amountCents = rate && rateCents !== null && Number.isFinite(hours) && hours > 0 ? lineAmountCents(hours, rateCents) : 0
    return { ...line, rate, amountCents, outside: line.costCode !== "" && isOutsideBudget(line.costCode, budget) }
  })
  const rateOptions = React.useMemo(
    () =>
      workspace.rates.map((rate) => ({
        value: rate.rateBookEntryId,
        label: rate.name,
        description: `${rateKindLabel(rate.kind)} · ${formatCents(rate.rateCents)}/hr`,
        keywords: rateKindLabel(rate.kind),
      })),
    [workspace.rates],
  )
  const hasLaborRate = workspace.rates.some((rate) => rate.kind === "labor")
  const hasMachineRate = workspace.rates.some((rate) => rate.kind === "machine")
  const totalCents = priced.reduce((sum, line) => sum + line.amountCents, 0)
  const outsideCount = priced.filter((line) => line.outside).length

  function updateLine(key: string, patch: Partial<Omit<EditableLine, "key">>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function addSageHours(selections: readonly SageHoursSelection[]): void {
    setLines((current) => {
      let next = current.filter((line) => line.costCode !== "" || line.hours.trim() !== "")
      for (const selection of selections) {
        const existing = next.find((line) => line.rateKind === "labor" && line.costCode === selection.costCode)
        if (existing) {
          const hours = (Number.parseFloat(existing.hours) || 0) + selection.hours
          next = next.map((line) => (line.key === existing.key ? { ...line, hours: String(Math.round(hours * 100) / 100) } : line))
        } else {
          next = [
            ...next,
            {
              key: crypto.randomUUID(),
              costCode: selection.costCode,
              description: descriptionFor.get(selection.costCode) ?? selection.sageCostCodeName ?? "",
              rateKind: "labor",
              hours: String(selection.hours),
              rateBookEntryId: null,
              rateOverride: "",
            },
          ]
        }
      }
      return next.length > 0 ? next : [blankLine()]
    })
    setSageClaims((current) => {
      const next = new Map(current ?? [])
      for (const selection of selections) {
        for (const claim of selection.claims) {
          next.set(claim.laborLineId, { hours: (next.get(claim.laborLineId)?.hours ?? 0) + claim.hours, costCode: selection.costCode })
        }
      }
      return next
    })
  }

  function input(): ShopTicketInput {
    const number = Number.parseInt(payAppNumber, 10)
    const application = workspace.payApplications.find((option) => option.number === number)
    return {
      ticketDate,
      laborFrom: laborFrom || null,
      laborTo: laborTo || null,
      payApplicationNumber: Number.isFinite(number) ? number : null,
      payApplicationMonth: payAppMonth ? `${payAppMonth}-01` : null,
      budgetApplicationId: application?.id ?? null,
      notes: notes.trim() || null,
      lines: lines
        .filter((line) => line.costCode !== "" || line.hours.trim() !== "")
        .map((line) => ({
          costCode: line.costCode,
          description: line.description,
          rateKind: line.rateKind,
          hours: Number.parseFloat(line.hours),
          rateBookEntryId: line.rateBookEntryId,
          rateOverrideCents: overrideCents(line.rateOverride),
        })),
      laborClaims: effectiveClaims ? [...effectiveClaims].map(([laborLineId, hours]) => ({ laborLineId, hours })) : undefined,
    }
  }

  async function save(): Promise<string | null> {
    const result = ticket ? await updateShopTicket(projectId, ticket.id, input()) : await createShopTicket(projectId, input())
    if (!result.success) {
      toast.error(result.error)
      return null
    }
    return result.ticketId
  }

  function saveDraft(): void {
    startTransition(async () => {
      const id = await save()
      if (!id) return
      toast.success("Draft saved")
      router.refresh()
      onClose()
    })
  }

  function issue(): void {
    startTransition(async () => {
      const id = await save()
      if (!id) return
      const result = await issueShopTicket(projectId, id, { budgetReviewed })
      if (!result.success) {
        toast.error(result.error)
        router.refresh()
        return
      }
      toast.success("Ticket issued. The PDF will be saved to the draw's receipts folder.")
      router.refresh()
      onClose()
    })
  }

  function removeDraft(): void {
    if (!ticket) {
      onClose()
      return
    }
    startTransition(async () => {
      const result = await deleteShopTicketDraft(projectId, ticket.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Draft ${ticket.ticketNumber} deleted`)
      router.refresh()
      onClose()
    })
  }

  return (
    <section className="grid gap-4 border-t pt-4" aria-label={ticket ? `Edit ${ticket.ticketNumber}` : "New shop ticket"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{ticket ? `Edit draft ${ticket.ticketNumber}` : "New shop ticket"}</h2>
        {!ticket ? <p className="text-sm text-muted-foreground">Compass assigns the next ticket number when you save.</p> : null}
      </div>

      <div className="grid gap-4 border-y py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="shop-ticket-date">Ticket date</Label>
          <Input id="shop-ticket-date" type="date" value={ticketDate} onChange={(event) => setTicketDate(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="shop-ticket-labor-from">Labor from</Label>
          <Input id="shop-ticket-labor-from" type="date" value={laborFrom} onChange={(event) => setLaborFrom(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="shop-ticket-labor-to">Labor to</Label>
          <Input id="shop-ticket-labor-to" type="date" value={laborTo} onChange={(event) => setLaborTo(event.target.value)} />
        </div>
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="shop-ticket-pay-app">Pay app</Label>
            <Input
              id="shop-ticket-pay-app"
              inputMode="numeric"
              value={payAppNumber}
              onChange={(event) => setPayAppNumber(event.target.value.replace(/\D/g, ""))}
              placeholder="7"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="shop-ticket-pay-month">Billing month</Label>
            <Input id="shop-ticket-pay-month" type="month" value={payAppMonth} onChange={(event) => setPayAppMonth(event.target.value)} />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Cost code</th>
              <th className="w-56 py-2 pr-2 font-medium">Rate book rate</th>
              <th className="w-28 py-2 pr-2 text-right font-medium">Hours</th>
              <th className="w-28 py-2 pr-2 text-right font-medium">Rate ($/hr)</th>
              <th className="w-28 py-2 pr-2 text-right font-medium">Amount</th>
              <th className="w-10 py-2" />
            </tr>
          </thead>
          <tbody>
            {priced.map((line, index) => (
              <tr key={line.key} className={line.outside ? "border-b bg-warning/10 align-top" : "border-b align-top"}>
                <td className="py-2 pr-2">
                  <SearchableCombobox
                    id={`shop-ticket-code-${index}`}
                    ariaLabel={`Cost code for line ${index + 1}`}
                    placeholder="Choose a cost code"
                    searchPlaceholder="Search cost codes..."
                    options={costCodeOptions}
                    value={line.costCode}
                    onValueChange={(value) => updateLine(line.key, { costCode: value, description: descriptionFor.get(value) ?? "" })}
                    className="w-full"
                  />
                  {line.outside ? (
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-warning">
                      <IconAlertTriangle className="size-4 shrink-0 text-warning" />
                      Not in this project&apos;s budget. Fix the cost code, or start a change order.
                      <Link
                        href={`/dashboard/projects/${projectId}/change-orders`}
                        className="underline underline-offset-2"
                        target="_blank"
                      >
                        Start change order
                      </Link>
                    </p>
                  ) : null}
                </td>
                <td className="py-2 pr-2">
                  <SearchableCombobox
                    id={`shop-ticket-rate-${index}`}
                    ariaLabel={`Rate for line ${index + 1}`}
                    placeholder="Choose a rate"
                    searchPlaceholder="Search rates..."
                    emptyMessage="No matching rates."
                    options={rateOptions}
                    value={line.rate?.rateBookEntryId ?? ""}
                    onValueChange={(value) => {
                      // The picker reports "" when it resets; keep the current choice.
                      const rate = workspace.rates.find((candidate) => candidate.rateBookEntryId === value)
                      if (rate) updateLine(line.key, { rateKind: rate.kind, rateBookEntryId: rate.rateBookEntryId })
                    }}
                    className="w-full"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    aria-label={`Hours for line ${index + 1}`}
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    value={line.hours}
                    onChange={(event) => updateLine(line.key, { hours: event.target.value.replace(/[^0-9.]/g, "") })}
                    placeholder="0.00"
                  />
                </td>
                <td className="py-2 pr-2">
                  {line.rate ? (
                    <>
                      <Input
                        aria-label={`Rate for line ${index + 1}, blank uses the rate book`}
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={line.rateOverride}
                        onChange={(event) => updateLine(line.key, { rateOverride: event.target.value.replace(/[^0-9.]/g, "") })}
                        placeholder={(line.rate.rateCents / 100).toFixed(2)}
                      />
                      {overrideCents(line.rateOverride) !== null && overrideCents(line.rateOverride) !== line.rate.rateCents ? (
                        <button
                          type="button"
                          className="mt-1 block w-full text-right text-xs text-muted-foreground underline underline-offset-2"
                          onClick={() => updateLine(line.key, { rateOverride: "" })}
                        >
                          Rate book {formatCents(line.rate.rateCents)}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <span className="block text-right text-destructive">Choose a rate</span>
                  )}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatCents(line.amountCents)}</td>
                <td className="py-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() => setLines((current) => (current.length > 1 ? current.filter((item) => item.key !== line.key) : [blankLine()]))}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2 pr-2 text-right font-semibold">
                Ticket total
              </td>
              <td className="py-2 pr-2 text-right font-semibold tabular-nums">{formatCents(totalCents)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, blankLine()])}>
          <IconPlus className="size-4" />
          Add line
        </Button>
      </div>

      <ShopTicketSageHours
        projectId={projectId}
        ticketId={ticket?.id ?? null}
        laborFrom={laborFrom}
        laborTo={laborTo}
        claims={effectiveClaims}
        onLoadedClaims={setSageClaims}
        onAdd={addSageHours}
      />

      {!hasLaborRate || !hasMachineRate ? (
        <p className="text-sm text-muted-foreground">
          Rates come from{" "}
          <Link href="/dashboard/settings?section=rate-book" className="underline underline-offset-2">
            Settings → Rate book
          </Link>
          .{!hasLaborRate ? " Add a Labor rate." : ""}
          {!hasMachineRate ? " Add a Machine rate." : ""}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="shop-ticket-notes">Notes (not printed)</Label>
        <Textarea id="shop-ticket-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {outsideCount > 0 ? (
        <div className="grid gap-2 rounded-lg bg-warning/10 p-3 text-sm">
          <p>
            {outsideCount === 1 ? "1 line uses a cost code" : `${outsideCount} lines use cost codes`} that isn&apos;t in this
            project&apos;s budget. Before issuing, change the code or start a change order, or confirm you&apos;ve reviewed it.
            Compass records who confirmed it.
          </p>
          <div className="flex items-center gap-2">
            <Checkbox id="shop-ticket-budget-reviewed" checked={budgetReviewed} onCheckedChange={(value) => setBudgetReviewed(value === true)} />
            <Label htmlFor="shop-ticket-budget-reviewed">Bill it as entered; I&apos;ve reviewed it</Label>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={issue} disabled={pending || (outsideCount > 0 && !budgetReviewed)}>
          Issue ticket
        </Button>
        <Button type="button" variant="outline" onClick={saveDraft} disabled={pending}>
          Save draft
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {ticket ? (
          <Button type="button" variant="ghost" className="text-destructive" onClick={removeDraft} disabled={pending}>
            Delete draft
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Issuing saves the PDF to the project&apos;s pay requests folder, in the draw&apos;s receipts folder.
      </p>
    </section>
  )
}
