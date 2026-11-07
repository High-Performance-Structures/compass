"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconArrowsExchange, IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  approveProjectVariance,
  createProjectVariance,
  reclassifyProjectChangeOrders,
  saveProjectVarianceLines,
  type ProjectVarianceOptions,
} from "@/app/actions/project-variances"
import { changeOrderMoney, ProjectChangeOrderOptionPicker } from "@/components/projects/project-change-order-option-picker"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ReorderHandle, SortableRow, SortableRows, SortByCostCodeButton } from "@/components/ui/sortable-rows"
import { Textarea } from "@/components/ui/textarea"
import { moveLine, sortLinesByCostCode } from "@/lib/shared/line-order"
import { contractTypeLabel } from "@/lib/domain/estimates/variance-rules"
import type { ProjectChangeOrderCostCodeOption, ProjectChangeOrderItem } from "@/lib/change-orders/types"

function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "")
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

/** Staff create a draft variance: a cost movement on a cost-plus job, numbered V-001 and up. */
export function NewVarianceButton({
  projectId,
  detailBaseHref,
  options,
}: {
  readonly projectId: string
  readonly detailBaseHref: string
  readonly options: ProjectVarianceOptions
}): React.ReactElement | null {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [scope, setScope] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  if (!options.canManage || !options.allowsVariances) return null

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await createProjectVariance(projectId, { title, scope, reason: reason.trim() || null })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Variance created. Add its cost lines, then approve it.")
      setOpen(false)
      router.push(`${detailBaseHref}/${encodeURIComponent(result.id)}`)
    })
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <IconPlus className="size-4" />New variance
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New variance</DialogTitle>
              <DialogDescription>
                A cost movement on a cost code, such as a material price going up or down. Staff approve it; the owner is
                informed and doesn&apos;t sign. This job is {contractTypeLabel(options.contractType).toLowerCase()}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="variance-title">Title</Label>
              <Input id="variance-title" value={title} maxLength={200} required disabled={pending}
                onChange={(event) => setTitle(event.target.value)} placeholder="Lumber price increase" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variance-scope">What moved</Label>
              <Textarea id="variance-scope" value={scope} maxLength={10_000} required disabled={pending}
                onChange={(event) => setScope(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variance-reason">Reason (optional)</Label>
              <Input id="variance-reason" value={reason} maxLength={4_000} disabled={pending}
                onChange={(event) => setReason(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending || !title.trim() || !scope.trim()}>Create variance</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Staff reclassify change orders as variances (numbered V-001 and up in date
 * order) or variances back to change orders. Amounts don't change; pay
 * applications show them in the other G703 column.
 */
export function ReclassifyChangeOrdersButton({
  projectId,
  items,
  options,
  label = "Reclassify",
}: {
  readonly projectId: string
  readonly items: readonly ProjectChangeOrderItem[]
  readonly options: ProjectVarianceOptions
  readonly label?: string
}): React.ReactElement | null {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [to, setTo] = React.useState<"variance" | "change_order">("variance")
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [pending, startTransition] = React.useTransition()
  const candidates = items.filter(
    (item) => item.canReclassify && item.recordType !== to && item.budgetTreatment === "additive" && item.kind !== "description"
  )
  if (!options.canManage || items.every((item) => !item.canReclassify)) return null
  const single = items.length === 1

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const ids = single ? candidates.map((item) => item.id) : [...selected]
    startTransition(async () => {
      const result = await reclassifyProjectChangeOrders(projectId, ids, to)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${result.count} reclassified.`)
      if (result.budgetNote) toast.warning(`The contract budget needs review: ${result.budgetNote}`)
      setOpen(false)
      setSelected(new Set())
      router.refresh()
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const first = items[0]
          setTo(single && first?.recordType === "variance" ? "change_order" : "variance")
          setOpen(true)
        }}
      >
        <IconArrowsExchange className="size-4" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{to === "variance" ? "Reclassify as variances" : "Reclassify as change orders"}</DialogTitle>
              <DialogDescription>
                {to === "variance"
                  ? "Each becomes a variance numbered V-001 and up in date order. Amounts and lines stay the same; the owner isn't asked to accept a variance."
                  : "Each becomes a change order again, with its earlier number when it's still free."}
              </DialogDescription>
            </DialogHeader>
            {!single ? (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={to === "variance" ? "default" : "outline"} disabled={!options.allowsVariances}
                  onClick={() => { setTo("variance"); setSelected(new Set()) }}>
                  Change orders → variances
                </Button>
                <Button type="button" size="sm" variant={to === "change_order" ? "default" : "outline"}
                  onClick={() => { setTo("change_order"); setSelected(new Set()) }}>
                  Variances → change orders
                </Button>
              </div>
            ) : null}
            {to === "variance" && !options.allowsVariances ? (
              <p className="text-sm text-destructive">This job is fixed price, so it has no variances.</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing here can be reclassified that way.</p>
            ) : single ? (
              <p className="text-sm">{candidates.map((item) => `${item.changeOrderNumber} · ${item.title}`).join(", ")}</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto border-y py-2">
                {candidates.map((item) => (
                  <label key={item.id} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (checked === true) next.add(item.id)
                          else next.delete(item.id)
                          return next
                        })
                      }
                    />
                    <span>
                      <span className="font-medium">{item.changeOrderNumber}</span> · {item.title}
                      <span className="block text-xs text-muted-foreground">{changeOrderMoney(item.amountCents)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button
                type="submit"
                disabled={pending || candidates.length === 0 || (!single && selected.size === 0) || (to === "variance" && !options.allowsVariances)}
              >
                Reclassify
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

type DraftLine = { readonly key: string; readonly costCode: string; readonly description: string; readonly amount: string }

/**
 * A draft variance's cost lines (increases positive, decreases negative) and
 * its Approve button. Approving adds the builder fee on straight cost-plus
 * jobs and liability insurance, then updates the contract budget.
 */
export function ProjectVarianceLines({
  item,
  options,
  costCodes,
}: {
  readonly item: ProjectChangeOrderItem
  readonly options: ProjectVarianceOptions
  readonly costCodes: readonly ProjectChangeOrderCostCodeOption[]
}): React.ReactElement | null {
  const router = useRouter()
  const priced = item.lines.filter((line) => line.derivedFrom === null)
  const [draft, setDraft] = React.useState<readonly DraftLine[]>(() =>
    (priced.length > 0 ? priced : [null]).map((line, index) => ({
      key: `line-${index}`,
      costCode: line?.costCode ?? "",
      description: line?.description ?? "",
      amount: line && line.amountCents !== null ? (line.amountCents / 100).toFixed(2) : "",
    }))
  )
  const [pending, startTransition] = React.useTransition()
  const nextKey = React.useRef(draft.length)
  if (!item.canEditVarianceLines || !options.canManage) return null

  const parsed = draft.map((line) => dollarsToCents(line.amount))
  const totalCents = parsed.reduce<number>((sum, cents) => sum + (cents ?? 0), 0)
  const ready = parsed.every((cents) => cents !== null && cents !== 0) && draft.every((line) => line.costCode && line.description.trim())
  const saved = priced.length > 0

  function updateLine(key: string, patch: Partial<Omit<DraftLine, "key">>): void {
    setDraft((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveProjectVarianceLines(
        item.projectId,
        item.id,
        draft.map((line, index) => ({ costCode: line.costCode, description: line.description, amountCents: parsed[index] ?? 0 }))
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Variance lines saved.")
      router.refresh()
    })
  }

  function approve(): void {
    startTransition(async () => {
      const result = await approveProjectVariance(item.projectId, item.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.budgetNote ? `Variance approved. The contract budget isn't updated yet: ${result.budgetNote}` : "Variance approved and the contract budget updated.")
      router.refresh()
    })
  }

  return (
    <section className="border-y bg-background p-4">
      <h2 className="text-sm font-semibold">Variance lines</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter each cost code that moved: increases as positive amounts, decreases as negative. On approval Compass adds
        {options.contractType === "cost_plus" ? " the builder fee and" : ""} project liability insurance, and the amount goes on
        each cost code&apos;s G703 line in the Variances column.
      </p>
      <form className="mt-4 space-y-3" onSubmit={save}>
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
            <Input aria-label={`Description for line ${index + 1}`} value={line.description} maxLength={500} disabled={pending}
              onChange={(event) => updateLine(line.key, { description: event.target.value })} />
            <Input aria-label={`Amount for line ${index + 1}`} value={line.amount} inputMode="decimal" placeholder="0.00"
              className="text-right tabular-nums" aria-invalid={parsed[index] === null && line.amount !== ""} disabled={pending}
              onChange={(event) => updateLine(line.key, { amount: event.target.value })} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${index + 1}`} disabled={pending || draft.length === 1}
              onClick={() => setDraft((current) => current.filter((candidate) => candidate.key !== line.key))}>
              <IconTrash className="size-4" />
            </Button>
          </SortableRow>
        ))}
        </SortableRows>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pending}
            onClick={() => {
              nextKey.current += 1
              setDraft((current) => [...current, { key: `line-${nextKey.current}`, costCode: "", description: "", amount: "" }])
            }}>
            <IconPlus className="size-4" />Add line
          </Button>
          <SortByCostCodeButton disabled={pending || draft.length < 2}
            onSort={() => setDraft((current) => sortLinesByCostCode(current, (line) => line.costCode))} />
          <p className="text-sm tabular-nums">Lines total {changeOrderMoney(totalCents)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={pending || !ready}>Save lines</Button>
          {item.canApproveVariance ? (
            <Button type="button" disabled={pending || !saved} onClick={approve}>Approve variance</Button>
          ) : null}
        </div>
        {!saved ? <p className="text-xs text-muted-foreground">Save the lines before approving.</p> : null}
      </form>
    </section>
  )
}
