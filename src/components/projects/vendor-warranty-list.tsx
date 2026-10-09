"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  updateVendorWarrantyClaim,
  type VendorWarrantyClaim,
  type VendorWarrantyWorkspace,
} from "@/app/actions/project-warranty-vendor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { VENDOR_WARRANTY_STATUSES } from "@/lib/warranty/status"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Readonly<Record<string, string>> = {
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  visit_scheduled: "Visit scheduled",
  in_progress: "In progress",
  waiting_on_owner: "Waiting on owner",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Rejected",
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

function formatWhen(value: string | null): string {
  if (!value) return "Not scheduled"
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

function VendorClaim({
  projectId,
  claim,
  canUpdate,
}: {
  readonly projectId: string
  readonly claim: VendorWarrantyClaim
  readonly canUpdate: boolean
}): React.ReactElement {
  const router = useRouter()
  const closed = claim.status === "closed" || claim.status === "rejected" || claim.ownerConfirmedAt !== null
  const initialStatus = VENDOR_WARRANTY_STATUSES.find((status) => status === claim.status) ?? "visit_scheduled"
  const [status, setStatus] = React.useState<string>(initialStatus)
  const [scheduledFor, setScheduledFor] = React.useState(claim.scheduledFor?.slice(0, 16) ?? "")
  const [note, setNote] = React.useState("")
  const [message, setMessage] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateVendorWarrantyClaim(projectId, claim.id, {
        status,
        scheduledFor: scheduledFor || null,
        note: note || null,
      })
      if (result.success) {
        setNote("")
        setMessage("Saved. The owner and office can see this update.")
        router.refresh()
      } else {
        setMessage(result.error)
      }
    })
  }

  return (
    <article className="border-b py-5 last:border-b-0" aria-labelledby={`claim-${claim.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground">{claim.claimNumber}</p>
          <h2 id={`claim-${claim.id}`} className="mt-1 text-lg font-semibold">{claim.title}</h2>
          <p className="text-sm text-muted-foreground">
            {[claim.location, claim.category, `Submitted by ${claim.claimantName}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className={cn("border px-2 py-1", claim.priority === "high" || claim.priority === "urgent" ? "border-destructive text-destructive" : "border-border")}>
            {claim.priority.charAt(0).toUpperCase() + claim.priority.slice(1)}
          </span>
          <span className="border border-border px-2 py-1">{statusLabel(claim.status)}</span>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{claim.description}</p>
      <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div><dt className="inline">Visit: </dt><dd className="inline text-foreground">{formatWhen(claim.scheduledFor)}</dd></div>
        <div><dt className="inline">Assigned: </dt><dd className="inline text-foreground">{claim.assignedName ?? "—"}</dd></div>
        <div><dt className="inline">Updated: </dt><dd className="inline text-foreground">{formatWhen(claim.updatedAt)}</dd></div>
      </dl>
      {claim.history.length > 0 ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-primary">Updates ({claim.history.length})</summary>
          <ul className="mt-2 divide-y border-y">
            {claim.history.map((event) => (
              <li key={event.id} className="py-2">
                <p className="text-xs text-muted-foreground">
                  {formatWhen(event.createdAt)} · {event.actorName}
                  {event.toStatus ? ` · ${statusLabel(event.toStatus)}` : ""}
                </p>
                {event.note ? <p className="mt-1 whitespace-pre-wrap">{event.note}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {canUpdate && !closed ? (
        <form className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2" onSubmit={save}>
          <div className="space-y-1.5">
            <Label htmlFor={`status-${claim.id}`}>Status</Label>
            <Select value={status} onValueChange={setStatus} disabled={pending}>
              <SelectTrigger id={`status-${claim.id}`} className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VENDOR_WARRANTY_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>{statusLabel(value)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`visit-${claim.id}`}>Visit / work date</Label>
            <Input id={`visit-${claim.id}`} type="datetime-local" value={scheduledFor} disabled={pending}
              onChange={(event) => setScheduledFor(event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`note-${claim.id}`}>Progress note for the owner</Label>
            <Textarea id={`note-${claim.id}`} rows={3} maxLength={2000} value={note} disabled={pending}
              placeholder="What you found, what you did, what's next"
              onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>Save update</Button>
            {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
            <p className="ml-auto text-xs text-muted-foreground">The owner confirms the work once it&apos;s resolved.</p>
          </div>
        </form>
      ) : closed ? (
        <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">
          {claim.ownerConfirmedAt ? "The owner confirmed this is resolved." : "This claim is closed."}
        </p>
      ) : null}
    </article>
  )
}

/** Claims assigned to this sub/vendor or their company; empty when nothing is assigned. */
export function VendorWarrantyList({
  projectId,
  workspace,
}: {
  readonly projectId: string
  readonly workspace: VendorWarrantyWorkspace
}): React.ReactElement {
  return (
    <section aria-labelledby="vendor-warranty-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-3">
        <h1 id="vendor-warranty-title" className="text-xl font-semibold">Warranty</h1>
        <span className="text-xs text-muted-foreground">
          {workspace.claims.length} assigned {workspace.claims.length === 1 ? "claim" : "claims"}
        </span>
      </div>
      {workspace.viewerIsInternal ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Preview: showing every claim assigned to a contact or vendor. Each vendor sees only their own, and staff update claims from the project&apos;s warranty page.
        </p>
      ) : null}
      {workspace.claims.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No warranty claims are assigned to you on this project.</p>
      ) : (
        workspace.claims.map((claim) => (
          <VendorClaim key={claim.id} projectId={projectId} claim={claim} canUpdate={!workspace.viewerIsInternal} />
        ))
      )}
    </section>
  )
}
