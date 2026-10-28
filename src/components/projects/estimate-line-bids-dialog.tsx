"use client"

import * as React from "react"
import { toast } from "sonner"

import { acceptEstimateBid, getEstimateLineBids, type EstimateLineBidsView } from "@/app/actions/estimate-bids"
import { Badge } from "@/components/ui/badge"
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
import { acceptableLines, type LineBid } from "@/lib/estimates/line-bids"
import { cn } from "@/lib/utils"

const STATE_LABEL: Readonly<Record<LineBid["state"], string>> = {
  quoted: "Quote in",
  declined: "Declined",
  approved: "Approved",
  accepted: "In this estimate",
}

function money(cents: number | null): string {
  return cents === null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function shortDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * The Bids window for one cost code: every price received for it, side by
 * side. Accepting a bid fills every cost code that vendor priced in the same
 * request (all ticked; untick any to give to someone else).
 */
export function EstimateLineBidsDialog({
  projectId,
  estimateId,
  lineId,
  open,
  onOpenChange,
  onAccepted,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly lineId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onAccepted: () => void
}): React.ReactElement {
  const [view, setView] = React.useState<EstimateLineBidsView | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pickedRfq, setPickedRfq] = React.useState<string | null>(null)
  const [lineNumbers, setLineNumbers] = React.useState<ReadonlySet<number>>(new Set())
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setView(null)
    setError(null)
    setPickedRfq(null)
    void getEstimateLineBids(projectId, estimateId, lineId).then((result) => {
      if (cancelled) return
      if (result.success) setView(result.data)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [open, projectId, estimateId, lineId])

  const picked = view?.bids.find((bid) => bid.rfqId === pickedRfq) ?? null

  function pick(bid: LineBid): void {
    if (bid.decision !== "quote" || bid.state === "accepted") return
    setPickedRfq(bid.rfqId)
    setLineNumbers(new Set(acceptableLines(bid).map((line) => line.lineNumber)))
  }

  function accept(): void {
    if (!picked) return
    startTransition(async () => {
      const result = await acceptEstimateBid(projectId, estimateId, picked.rfqId, [...lineNumbers])
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${picked.vendor} accepted. ${result.data.lineCount} cost code${result.data.lineCount === 1 ? "" : "s"} filled in the estimate.`)
      onOpenChange(false)
      onAccepted()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bids for {view ? `${view.costCode} · ${view.costCodeName}` : "this cost code"}</DialogTitle>
          <DialogDescription>
            Every price received on this job for this cost code. Choose one to accept; it fills each cost code that vendor
            priced, and they join the job&apos;s selected trades.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !view ? (
          <p className="text-sm text-muted-foreground">Loading bids…</p>
        ) : view.bids.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No prices in yet for this cost code. Request quotes from Pricing requests; answers show up here as they come in.
          </p>
        ) : (
          <div className="divide-y border-y" role="radiogroup" aria-label="Bids">
            {view.bids.map((bid, index) => {
              const selectable = view.canAccept && bid.decision === "quote" && bid.state !== "accepted"
              const isPicked = bid.rfqId === pickedRfq
              const others = bid.lines.filter((line) => line.costCode !== view.costCode)
              return (
                <div
                  key={bid.rfqId}
                  role="radio"
                  aria-checked={isPicked}
                  aria-disabled={!selectable}
                  tabIndex={selectable ? 0 : -1}
                  onClick={() => selectable && pick(bid)}
                  onKeyDown={(event) => {
                    if (selectable && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault()
                      pick(bid)
                    }
                  }}
                  className={cn("grid gap-1 px-3 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", selectable && "cursor-pointer hover:bg-muted/50", isPicked && "bg-accent")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{bid.vendor}</span>{" "}
                      {index === 0 && bid.decision === "quote" && view.bids.filter((item) => item.decision === "quote").length > 1 && (
                        <Badge variant="outline" className="ml-1">Lowest</Badge>
                      )}
                      <Badge variant={bid.state === "accepted" ? "default" : "secondary"} className="ml-1">{STATE_LABEL[bid.state]}</Badge>
                      <p className="text-xs text-muted-foreground">{bid.rfqNumber ?? "RFQ"} · answered {shortDate(bid.submittedAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{bid.decision === "quote" ? money(bid.priceCents) : "—"}</p>
                      {others.length > 0 && bid.totalCents !== null && (
                        <p className="text-xs text-muted-foreground tabular-nums">Package {money(bid.totalCents)}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[bid.leadTime ? `Lead time ${bid.leadTime}` : null, bid.validUntil ? `Good until ${shortDate(bid.validUntil)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {others.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Also priced: {others.map((line) => `${line.costCode ?? line.description} ${money(line.amountCents)}`).join(" · ")}
                    </p>
                  )}
                  {bid.notes && <p className="whitespace-pre-line text-xs">{bid.notes}</p>}
                </div>
              )
            })}
          </div>
        )}

        {picked && (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Fill these cost codes with {picked.vendor}&apos;s prices</legend>
            {acceptableLines(picked).map((line) => (
              <label key={line.lineNumber} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <Checkbox
                    checked={lineNumbers.has(line.lineNumber)}
                    onCheckedChange={(checked) =>
                      setLineNumbers((current) => {
                        const next = new Set(current)
                        if (checked === true) next.add(line.lineNumber)
                        else next.delete(line.lineNumber)
                        return next
                      })
                    }
                  />
                  {line.costCode ? `${line.costCode} · ` : ""}
                  {line.description}
                </span>
                <span className="tabular-nums">{money(line.amountCents)}</span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              Untick any you&apos;ll give to someone else. Codes waiting at $0 on this estimate are filled; any others are added as new lines.
            </p>
          </fieldset>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {view?.canAccept && (
            <Button type="button" disabled={!picked || lineNumbers.size === 0 || pending} onClick={accept}>
              {pending ? "Accepting…" : picked ? `Accept ${picked.vendor}` : "Choose a bid"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
