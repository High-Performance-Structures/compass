"use client"

import * as React from "react"
import { IconEdit, IconMessageReply } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import {
  saveManualProjectRfqResponse,
  type ManualRfqResponseEventItem,
} from "@/app/actions/project-rfq-manual-response"
import type { ProjectRfqItem } from "@/app/actions/project-operations"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Decision = "quote" | "decline"
type Source = "email" | "phone" | "other"

function initialLineAmounts(rfq: ProjectRfqItem): Record<number, string> {
  const values: Record<number, string> = {}
  for (const line of rfq.scopeItems) {
    const responseLine = rfq.vendorResponse?.lines.find((item) => item.lineNumber === line.lineNumber)
    values[line.lineNumber] = responseLine ? String(responseLine.amount) : ""
  }
  return values
}

export function ProjectRfqManualResponse({
  projectId, rfq, approved, events,
}: {
  readonly projectId: string
  readonly rfq: ProjectRfqItem
  readonly approved: boolean
  readonly events: readonly ManualRfqResponseEventItem[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [decision, setDecision] = React.useState<Decision>(rfq.vendorResponse?.decision ?? "quote")
  const [source, setSource] = React.useState<Source>("email")
  const [receivedDate, setReceivedDate] = React.useState(rfq.vendorResponse?.submittedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
  const [responderName, setResponderName] = React.useState(rfq.vendorResponse?.responderName ?? rfq.companyName ?? "")
  const [sourceReference, setSourceReference] = React.useState("")
  const [lineAmounts, setLineAmounts] = React.useState<Record<number, string>>(() => initialLineAmounts(rfq))
  const [total, setTotal] = React.useState(rfq.vendorResponse?.amount === null || rfq.vendorResponse?.amount === undefined ? "" : String(rfq.vendorResponse.amount))
  const [leadTime, setLeadTime] = React.useState(rfq.vendorResponse?.leadTime ?? "")
  const [validUntil, setValidUntil] = React.useState(rfq.vendorResponse?.validUntil ?? "")
  const [notes, setNotes] = React.useState(rfq.vendorResponse?.notes ?? "")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const sum = rfq.scopeItems.reduce((value, line) => value + Number(lineAmounts[line.lineNumber] || 0), 0)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setPending(true)
    setError(null)
    const lines = decision === "quote" ? rfq.scopeItems.map((line) => ({
      lineNumber: line.lineNumber,
      amount: lineAmounts[line.lineNumber]?.trim() ? Number(lineAmounts[line.lineNumber]) : null,
      notes: rfq.vendorResponse?.lines.find((item) => item.lineNumber === line.lineNumber)?.notes ?? null,
    })) : []
    const amount = decision === "quote"
      ? (rfq.scopeItems.length > 0 ? Math.round(sum * 100) / 100 : total.trim() ? Number(total) : null)
      : null
    const result = await saveManualProjectRfqResponse(projectId, rfq.id, {
      expectedUpdatedAt: rfq.updatedAt,
      decision,
      receivedVia: source,
      receivedDate,
      responderName,
      sourceReference: sourceReference.trim() || null,
      amount,
      lines,
      leadTime: leadTime.trim() || null,
      validUntil: validUntil || null,
      notes: notes.trim() || null,
    })
    setPending(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={approved || !["draft", "sent", "response_received", "declined"].includes(rfq.status)}>
            {rfq.vendorResponse ? <IconEdit className="size-4" /> : <IconMessageReply className="size-4" />}
            {rfq.vendorResponse ? "Update response" : "Record response"}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{rfq.vendorResponse ? "Update" : "Record"} vendor response</DialogTitle>
              <DialogDescription>
                Enter a quote or decline received by email, phone, or another channel.
                Changes are recorded with your name and time. Approved pricing is locked.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor={`rfq-source-${rfq.id}`}>Received via</Label>
                <Select value={source} onValueChange={(value) => {
                  if (value === "email" || value === "phone" || value === "other") setSource(value)
                }}>
                  <SelectTrigger id={`rfq-source-${rfq.id}`} className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor={`rfq-received-${rfq.id}`}>Received on</Label>
                <Input id={`rfq-received-${rfq.id}`} type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.currentTarget.value)} required />
              </div>
              <div className="space-y-1.5"><Label htmlFor={`rfq-decision-${rfq.id}`}>Vendor decision</Label>
                <Select value={decision} onValueChange={(value) => {
                  if (value === "quote" || value === "decline") setDecision(value)
                }}>
                  <SelectTrigger id={`rfq-decision-${rfq.id}`} className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quote">Quoted</SelectItem>
                    <SelectItem value="decline">Declined</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor={`rfq-responder-${rfq.id}`}>Vendor contact or company</Label>
                <Input id={`rfq-responder-${rfq.id}`} value={responderName} onChange={(event) => setResponderName(event.currentTarget.value)} required />
              </div>
            </div>
            {decision === "quote" && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-sm font-medium">Scope prices</p>
                {rfq.scopeItems.map((line) => (
                  <div key={line.lineNumber} className="grid items-center gap-2 sm:grid-cols-[1fr_9rem]">
                    <Label htmlFor={`rfq-line-${rfq.id}-${line.lineNumber}`}>{line.lineNumber}. {line.description}</Label>
                    <Input id={`rfq-line-${rfq.id}-${line.lineNumber}`} type="number" min="0" step="0.01" value={lineAmounts[line.lineNumber] ?? ""} onChange={(event) => setLineAmounts((current) => ({ ...current, [line.lineNumber]: event.currentTarget.value }))} required />
                  </div>
                ))}
                <div className="space-y-1.5"><Label htmlFor={`rfq-total-${rfq.id}`}>Quoted total</Label>
                  <Input id={`rfq-total-${rfq.id}`} type="number" min="0" step="0.01" value={rfq.scopeItems.length > 0 ? sum.toFixed(2) : total} onChange={(event) => setTotal(event.currentTarget.value)} readOnly={rfq.scopeItems.length > 0} required />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor={`rfq-lead-${rfq.id}`}>Lead time · optional</Label><Input id={`rfq-lead-${rfq.id}`} value={leadTime} onChange={(event) => setLeadTime(event.currentTarget.value)} /></div>
                  <div className="space-y-1.5"><Label htmlFor={`rfq-valid-${rfq.id}`}>Valid until · optional</Label><Input id={`rfq-valid-${rfq.id}`} type="date" value={validUntil} onChange={(event) => setValidUntil(event.currentTarget.value)} /></div>
                </div>
              </div>
            )}
            <div className="space-y-1.5"><Label htmlFor={`rfq-reference-${rfq.id}`}>Source reference · optional</Label>
              <Input id={`rfq-reference-${rfq.id}`} value={sourceReference} onChange={(event) => setSourceReference(event.currentTarget.value)} placeholder="Email date, file link, or call note" />
            </div>
            <div className="space-y-1.5"><Label htmlFor={`rfq-notes-${rfq.id}`}>Notes · optional</Label>
              <Textarea id={`rfq-notes-${rfq.id}`} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save vendor response"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {events.length > 0 && (
        <section className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          <h3 className="font-semibold uppercase">Manual response history</h3>
          {events.map((event) => (
            <p key={event.id} className="mt-1">
              {event.receivedVia} · {new Date(event.recordedAt).toLocaleString("en-US")}
              {" · "}{event.recordedByName}
              {event.sourceReference ? ` · ${event.sourceReference}` : ""}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}
