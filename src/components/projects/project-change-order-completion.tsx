"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { completeExecutedProjectChangeOrder } from "@/app/actions/project-change-order-completion"
import {
  changeOrderMoney,
  ProjectChangeOrderOptionPicker,
} from "@/components/projects/project-change-order-option-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReorderHandle, SortableRow, SortableRows, SortByCostCodeButton } from "@/components/ui/sortable-rows"
import { moveLine, sortLinesByCostCode } from "@/lib/shared/line-order"
import type {
  ProjectChangeOrderCostCodeOption,
  ProjectChangeOrderItem,
} from "@/lib/change-orders/types"

type DraftLine = {
  readonly key: string
  readonly costCode: string
  readonly description: string
  /** Dollars as typed. */
  readonly amount: string
}

function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "")
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

/**
 * Lets an approver split an imported executed change order across cost codes
 * (and date it) so it can revise the contract budget. The signed amount stays
 * fixed; the lines must add up to it.
 */
export function ProjectChangeOrderCompletion({
  projectId,
  changeOrderId,
  amountCents,
  executed,
  executedOn,
  lines,
  costCodes,
}: {
  readonly projectId: string
  readonly changeOrderId: string
  readonly amountCents: number | null
  /** An open imported change order gets its lines coded now and is dated when executed. */
  readonly executed: boolean
  readonly executedOn: string | null
  readonly lines: ProjectChangeOrderItem["lines"]
  readonly costCodes: readonly ProjectChangeOrderCostCodeOption[]
}): React.ReactElement {
  const router = useRouter()
  const [draft, setDraft] = React.useState<readonly DraftLine[]>(() =>
    (lines.length > 0 ? lines : [null]).map((line, index) => ({
      key: `line-${index}`,
      costCode: line?.costCode ?? "",
      description: line?.description ?? "",
      amount: line && line.amountCents !== null ? (line.amountCents / 100).toFixed(2) : "",
    }))
  )
  const [date, setDate] = React.useState(executedOn ?? "")
  const [reason, setReason] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const nextKey = React.useRef(draft.length)

  const parsed = draft.map((line) => dollarsToCents(line.amount))
  const totalCents = parsed.reduce<number>((sum, cents) => sum + (cents ?? 0), 0)
  const remainingCents = amountCents === null ? null : amountCents - totalCents
  const ready =
    amountCents !== null &&
    remainingCents === 0 &&
    parsed.every((cents) => cents !== null) &&
    draft.every((line) => line.costCode && line.description.trim()) &&
    (!executed || date !== "") &&
    reason.trim() !== ""

  function updateLine(key: string, patch: Partial<Omit<DraftLine, "key">>): void {
    setDraft((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function addLine(): void {
    nextKey.current += 1
    setDraft((current) => [
      ...current,
      { key: `line-${nextKey.current}`, costCode: "", description: current[0]?.description ?? "", amount: "" },
    ])
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await completeExecutedProjectChangeOrder(projectId, changeOrderId, {
        lines: draft.map((line, index) => ({
          costCode: line.costCode,
          description: line.description,
          amountCents: parsed[index] ?? 0,
        })),
        executedOn: date,
        reason,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.budgetNote
          ? `Cost codes saved. The contract budget isn't updated yet: ${result.budgetNote}`
          : "Cost codes saved and the contract budget updated."
      )
      router.refresh()
    })
  }

  return (
    <section className="border-y bg-background p-4">
      <h2 className="text-sm font-semibold">Complete cost codes</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {executed
          ? <>This imported change order is executed but can&apos;t revise the budget until its{" "}
              {changeOrderMoney(amountCents)} is split across cost codes{executedOn ? "" : " and its execution date is recorded"}.
              The signed amount doesn&apos;t change.</>
          : <>This imported change order needs its {changeOrderMoney(amountCents)} split across cost codes before it
              can be executed. The amount doesn&apos;t change.</>}
      </p>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <div className="space-y-2">
          <SortableRows ids={draft.map((line) => line.key)} disabled={pending}
            onMove={(from, to) => setDraft((current) => moveLine(current, from, to))}>
          {draft.map((line, index) => (
            <SortableRow key={line.key} id={line.key} index={index}
              className="grid gap-2 bg-background sm:grid-cols-[2.75rem_minmax(0,14rem)_minmax(0,1fr)_8rem_auto] sm:items-center">
              <ReorderHandle label={`line ${index + 1}`} />
              <ProjectChangeOrderOptionPicker
                value={line.costCode}
                options={costCodes}
                placeholder="Cost code"
                ariaLabel={`Cost code for line ${index + 1}`}
                disabled={pending}
                onValueChange={(costCode) => updateLine(line.key, { costCode })}
              />
              <Input
                aria-label={`Description for line ${index + 1}`}
                value={line.description}
                onChange={(event) => updateLine(line.key, { description: event.target.value })}
                maxLength={500}
                disabled={pending}
              />
              <Input
                aria-label={`Amount for line ${index + 1}`}
                value={line.amount}
                onChange={(event) => updateLine(line.key, { amount: event.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                className="text-right tabular-nums"
                aria-invalid={parsed[index] === null && line.amount !== ""}
                disabled={pending}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${index + 1}`}
                onClick={() => setDraft((current) => current.filter((candidate) => candidate.key !== line.key))}
                disabled={pending || draft.length === 1}
              >
                <IconTrash className="size-4" />
              </Button>
            </SortableRow>
          ))}
          </SortableRows>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={pending}>
                <IconPlus className="size-4" />Add line
              </Button>
              <SortByCostCodeButton disabled={pending || draft.length < 2}
                onSort={() => setDraft((current) => sortLinesByCostCode(current, (line) => line.costCode))} />
            </div>
            <p className="text-sm tabular-nums">
              Lines {changeOrderMoney(totalCents)} of {changeOrderMoney(amountCents)}
              {remainingCents !== null && remainingCents !== 0 && (
                <span className="text-destructive"> · {changeOrderMoney(remainingCents)} left to assign</span>
              )}
            </p>
          </div>
        </div>
        <div className={executed ? "grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]" : "grid gap-4"}>
          {executed && <div className="space-y-2">
            <Label htmlFor="change-order-completion-date">Executed on</Label>
            <Input
              id="change-order-completion-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={pending || executedOn !== null}
              required
            />
          </div>}
          <div className="space-y-2">
            <Label htmlFor="change-order-completion-reason">Source of the split</Label>
            <Input
              id="change-order-completion-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="From the signed change order and Sage progress billing."
              maxLength={1000}
              required
              disabled={pending}
            />
          </div>
        </div>
        <Button type="submit" disabled={pending || !ready}>
          Save cost codes
        </Button>
      </form>
    </section>
  )
}
