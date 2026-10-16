"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { IconCash, IconExternalLink, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  saveProjectContractDeposit,
  voidProjectContractDeposit,
  type ProjectContractDepositItem,
  type ProjectContractDepositSummary,
} from "@/app/actions/project-contract-deposits"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function amountField(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? "").replaceAll(/[$,]/g, "").trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : Number.NaN
}

function textField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim()
  return value || null
}

const METHOD_LABELS: Readonly<Record<string, string>> = {
  check: "Check",
  ach: "ACH",
  wire: "Wire",
  card: "Card",
  cash: "Cash",
  other: "Other",
}

const STATUS_LABELS: Readonly<Record<ProjectContractDepositItem["status"], string>> = {
  requested: "Requested",
  received: "Received",
  void: "Void",
}

function DepositDialog({
  projectId,
  deposit,
  suggestedCents,
  open,
  onOpenChange,
}: {
  readonly projectId: string
  readonly deposit: ProjectContractDepositItem | null
  readonly suggestedCents: number | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // Opening a request is usually to record its payment.
  const [status, setStatus] = useState<"requested" | "received">("received")
  const [method, setMethod] = useState(deposit?.paymentMethod ?? "check")
  const received = status === "received"
  const defaultRequested = deposit?.requestedAmountCents ?? suggestedCents

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveProjectContractDeposit(projectId, deposit?.id ?? null, {
        status,
        requestedAmount: amountField(formData, "requestedAmount"),
        requestedAt: textField(formData, "requestedAt"),
        dueDate: textField(formData, "dueDate"),
        receivedAmount: amountField(formData, "receivedAmount"),
        receivedAt: textField(formData, "receivedAt"),
        paymentMethod: received ? method : null,
        reference: textField(formData, "reference"),
        evidenceUrl: textField(formData, "evidenceUrl"),
        evidenceLabel: textField(formData, "evidenceLabel"),
        notes: textField(formData, "notes"),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(received ? "Deposit recorded." : "Deposit request saved.")
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{deposit ? "Edit deposit" : "Record a deposit"}</DialogTitle>
          <DialogDescription>
            A received deposit is applied to pay applications before the client pays the balance.
          </DialogDescription>
        </DialogHeader>
        <form id="contract-deposit-form" onSubmit={save} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="depositStatus">Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value === "requested" ? "requested" : "received")}>
              <SelectTrigger id="depositStatus"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="requested">Requested (waiting for payment)</SelectItem>
                <SelectItem value="received">Received</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="requestedAmount">Requested amount</Label>
              <Input
                id="requestedAmount"
                name="requestedAmount"
                inputMode="decimal"
                defaultValue={defaultRequested ? (defaultRequested / 100).toFixed(2) : ""}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="requestedAt">Requested on</Label>
              <Input id="requestedAt" name="requestedAt" type="date" defaultValue={deposit?.requestedAt ?? ""} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dueDate">Due</Label>
              <Input id="dueDate" name="dueDate" type="date" defaultValue={deposit?.dueDate ?? ""} />
            </div>
          </div>
          {received && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="receivedAmount">Amount received</Label>
                <Input
                  id="receivedAmount"
                  name="receivedAmount"
                  inputMode="decimal"
                  defaultValue={
                    deposit?.receivedAmountCents
                      ? (deposit.receivedAmountCents / 100).toFixed(2)
                      : defaultRequested
                        ? (defaultRequested / 100).toFixed(2)
                        : ""
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="receivedAt">Date received</Label>
                <Input id="receivedAt" name="receivedAt" type="date" max={today()} defaultValue={deposit?.receivedAt ?? ""} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="paymentMethod">Paid by</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id="paymentMethod"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reference">Check or reference no.</Label>
                <Input id="reference" name="reference" maxLength={120} defaultValue={deposit?.reference ?? ""} />
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="evidenceUrl">Receipt or request link (optional)</Label>
              <Input id="evidenceUrl" name="evidenceUrl" type="url" placeholder="https://drive.google.com/..." defaultValue={deposit?.evidenceUrl ?? ""} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="evidenceLabel">Link label</Label>
              <Input id="evidenceLabel" name="evidenceLabel" maxLength={200} defaultValue={deposit?.evidenceLabel ?? ""} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="depositNotes">Notes</Label>
            <Textarea id="depositNotes" name="notes" maxLength={2000} defaultValue={deposit?.notes ?? ""} />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="contract-deposit-form" disabled={pending}>
            {pending ? "Saving…" : "Save deposit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Deposits on the contract: requested, received and applied to pay applications. */
export function ProjectContractDepositsPanel({
  projectId,
  summary,
}: {
  readonly projectId: string
  readonly summary: ProjectContractDepositSummary
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<ProjectContractDepositItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)

  function openDialog(deposit: ProjectContractDepositItem | null): void {
    setEditing(deposit)
    setDialogKey((key) => key + 1)
    setDialogOpen(true)
  }

  function voidDeposit(deposit: ProjectContractDepositItem): void {
    if (!window.confirm("Void this deposit? It will no longer be applied to pay applications.")) return
    startTransition(async () => {
      const result = await voidProjectContractDeposit(projectId, deposit.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Deposit voided.")
      router.refresh()
    })
  }

  const outstandingRequestCents = Math.max(0, summary.requestedCents - summary.receivedCents)

  return (
    <section className="clarity-panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <IconCash className="size-4 text-muted-foreground" />
            Contract deposits
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.autoApplyToPayApplications
              ? "Received deposits are applied to the next pay applications automatically; you can change the amount on a draft pay application."
              : "Apply received deposits on each draft pay application."}
            {summary.contractDeposit
              ? ` The contract calls for a ${(summary.contractDeposit.rateBasisPoints / 100).toLocaleString("en-US")}% deposit (${money(summary.contractDeposit.cents)}).`
              : ""}
          </p>
        </div>
        {summary.canEdit && (
          <Button size="sm" onClick={() => openDialog(null)}>
            <IconPlus className="size-4" />
            Record deposit
          </Button>
        )}
      </div>
      <div className="grid divide-y sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {[
          ["Received", summary.receivedCents],
          ["Applied to pay applications", summary.appliedCents],
          ["Not yet applied", summary.unappliedCents],
          ["Requested, not received", outstandingRequestCents],
        ].map(([label, value]) => (
          <div key={String(label)} className="px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{money(Number(value))}</p>
          </div>
        ))}
      </div>
      {summary.deposits.length > 0 && (
        <ul className="divide-y border-t">
          {summary.deposits.map((deposit) => (
            <li key={deposit.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span className="tabular-nums">
                    {money(deposit.receivedAmountCents ?? deposit.requestedAmountCents ?? 0)}
                  </span>
                  <Badge variant={deposit.status === "received" ? "default" : "outline"}>{STATUS_LABELS[deposit.status]}</Badge>
                  {deposit.sourceSystem !== "compass" && <Badge variant="outline">From {deposit.sourceSystem}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {deposit.status === "received"
                    ? [
                        deposit.receivedAt ? `Received ${deposit.receivedAt}` : null,
                        deposit.paymentMethod ? METHOD_LABELS[deposit.paymentMethod] ?? deposit.paymentMethod : null,
                        deposit.reference ? `#${deposit.reference}` : null,
                      ].filter(Boolean).join(" · ")
                    : [
                        deposit.requestedAt ? `Requested ${deposit.requestedAt}` : "Requested",
                        deposit.dueDate ? `due ${deposit.dueDate}` : null,
                      ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {deposit.evidenceUrl && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={deposit.evidenceUrl} target="_blank" rel="noreferrer">
                      <IconExternalLink className="size-4" />
                      {deposit.evidenceLabel ?? "Document"}
                    </a>
                  </Button>
                )}
                {summary.canEdit && deposit.status !== "void" && deposit.sourceSystem === "compass" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => openDialog(deposit)} disabled={pending}>
                      {deposit.status === "requested" ? "Record payment" : "Edit"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => voidDeposit(deposit)} disabled={pending}>
                      Void
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <DepositDialog
        key={dialogKey}
        projectId={projectId}
        deposit={editing}
        suggestedCents={summary.contractDeposit?.cents ?? null}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </section>
  )
}
