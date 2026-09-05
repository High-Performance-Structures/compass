"use client"

import * as React from "react"
import { IconSend } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import { submitSubVendorRfqResponse } from "@/app/actions/project-audience-sub-vendor"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type {
  PortalRfqScopeItem,
  PortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"
import { portalRfqCanReceiveResponse } from "@/lib/rfqs/portal-response"

type Decision = "quote" | "decline"

export function ProjectAudienceRfqResponseDialog({
  projectId,
  rfqId,
  rfqTitle,
  status,
  response,
  scopeItems,
  viewerIsInternal,
}: {
  readonly projectId: string
  readonly rfqId: string
  readonly rfqTitle: string
  readonly status: string
  readonly response: PortalRfqVendorResponse | null
  readonly scopeItems: readonly PortalRfqScopeItem[]
  readonly viewerIsInternal: boolean
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [decision, setDecision] = React.useState<Decision>(
    response?.decision ?? "quote"
  )
  const [amount, setAmount] = React.useState(
    response?.amount === null || response?.amount === undefined
      ? ""
      : String(response.amount)
  )
  const [leadTime, setLeadTime] = React.useState(response?.leadTime ?? "")
  const [validUntil, setValidUntil] = React.useState(response?.validUntil ?? "")
  const [notes, setNotes] = React.useState(response?.notes ?? "")
  const [lineAmounts, setLineAmounts] = React.useState<
    ReadonlyMap<number, string>
  >(
    () =>
      new Map(
        scopeItems.map((line) => [
          line.lineNumber,
          response?.lines.find(
            (responseLine) => responseLine.lineNumber === line.lineNumber
          )?.amount.toString() ?? "",
        ])
      )
  )
  const [lineNotes, setLineNotes] = React.useState<
    ReadonlyMap<number, string>
  >(
    () =>
      new Map(
        scopeItems.map((line) => [
          line.lineNumber,
          response?.lines.find(
            (responseLine) => responseLine.lineNumber === line.lineNumber
          )?.notes ?? "",
        ])
      )
  )
  const [error, setError] = React.useState<string | null>(null)
  const acceptsResponse = portalRfqCanReceiveResponse(status)

  function changeDecision(value: string): void {
    if (value === "quote" || value === "decline") setDecision(value)
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)
    const parsedAmount = amount.trim().length > 0 ? Number(amount) : null
    startTransition(async () => {
      const result = await submitSubVendorRfqResponse(projectId, rfqId, {
        decision,
        amount: parsedAmount,
        lines: scopeItems.map((line) => {
          const lineAmount = lineAmounts.get(line.lineNumber)?.trim() ?? ""
          return {
            lineNumber: line.lineNumber,
            amount: lineAmount.length > 0 ? Number(lineAmount) : null,
            notes: lineNotes.get(line.lineNumber) ?? null,
          }
        }),
        leadTime,
        validUntil,
        notes,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          disabled={viewerIsInternal || !acceptsResponse}
          title={
            viewerIsInternal
              ? "Sign in as the assigned vendor to submit a response."
              : !acceptsResponse
                ? "This RFQ is not accepting responses."
                : undefined
          }
        >
          <IconSend className="size-4" />
          {response ? "Revise response" : "Respond"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Respond to {rfqTitle}</DialogTitle>
            <DialogDescription>
              Submit pricing and delivery notes to the internal project team.
              You can revise the response while the RFQ remains open.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Response
              <Select value={decision} onValueChange={changeDecision}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quote">Submit a quote</SelectItem>
                  <SelectItem value="decline">Decline to quote</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {decision === "quote" && scopeItems.length === 0 && (
              <label className="grid gap-1.5 text-sm font-medium">
                Quote amount
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.currentTarget.value)}
                  placeholder="0.00"
                  required
                />
              </label>
            )}
            {decision === "quote" && scopeItems.length > 0 && (
              <div className="grid gap-2 sm:col-span-2">
                <p className="text-sm font-medium">Scope pricing</p>
                <div className="overflow-hidden border">
                  {scopeItems.map((line) => (
                    <div
                      key={line.lineNumber}
                      className="grid gap-2 border-b p-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_9rem]"
                    >
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">
                          {line.lineNumber}. {line.description}
                        </p>
                        <Input
                          value={lineNotes.get(line.lineNumber) ?? ""}
                          onChange={(event) =>
                            setLineNotes((current) => {
                              const next = new Map(current)
                              next.set(line.lineNumber, event.currentTarget.value)
                              return next
                            })
                          }
                          maxLength={2_000}
                          className="mt-2"
                          placeholder="Line note or exclusion"
                        />
                      </div>
                      <label className="grid content-start gap-1 text-xs font-medium text-muted-foreground">
                        Price
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={lineAmounts.get(line.lineNumber) ?? ""}
                          onChange={(event) =>
                            setLineAmounts((current) => {
                              const next = new Map(current)
                              next.set(line.lineNumber, event.currentTarget.value)
                              return next
                            })
                          }
                          placeholder="0.00"
                          required
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-right text-sm font-medium">
                  Total: {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                  }).format(
                    [...lineAmounts.values()].reduce((total, value) => {
                      const parsed = Number(value)
                      return total + (Number.isFinite(parsed) ? parsed : 0)
                    }, 0)
                  )}
                </p>
              </div>
            )}
            <label className="grid gap-1.5 text-sm font-medium">
              Lead time
              <Input
                value={leadTime}
                onChange={(event) => setLeadTime(event.currentTarget.value)}
                maxLength={240}
                placeholder="Example: 3 weeks"
              />
            </label>
            {decision === "quote" && (
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                Quote valid until
                <Input
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.currentTarget.value)}
                />
              </label>
            )}
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Notes, exclusions, and clarifications
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.currentTarget.value)}
                maxLength={10_000}
                className="min-h-32"
                placeholder="Include assumptions, alternates, exclusions, or questions."
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive sm:col-span-2">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting..." : "Submit response"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
