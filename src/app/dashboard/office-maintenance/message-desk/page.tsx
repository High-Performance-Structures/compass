export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconInbox, IconPhone } from "@tabler/icons-react"

import {
  getStaffMessageDesk,
  submitCreateStaffMessage,
  submitRouteGotoTextToMessageDesk,
  submitUpdateStaffMessageStatus,
} from "@/app/actions/staff-message-desk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SearchableStaffFormSelect } from "@/components/office/searchable-staff-form-select"
import {
  parseStaffMessageStatus,
  STAFF_MESSAGE_STATUS_OPTIONS,
  staffMessageStatusLabel,
  type StaffMessageStatus,
} from "@/lib/staff-message-desk"

type StaffMessageFilter = "open" | "all" | StaffMessageStatus

function fieldClassName(): string {
  return "h-10 border bg-background px-3 text-sm"
}

function timestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function messageFilter(value: string | undefined): StaffMessageFilter {
  if (value === "all" || value === "open") return value
  return value ? parseStaffMessageStatus(value) ?? "open" : "open"
}

function matchesFilter(
  status: StaffMessageStatus,
  filter: StaffMessageFilter
): boolean {
  if (filter === "all") return true
  if (filter === "open") return status !== "closed"
  return status === filter
}

export default async function StaffMessageDeskPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string }>
}): Promise<React.ReactElement> {
  const query = await searchParams
  const selectedFilter = messageFilter(query.status)
  const result = await getStaffMessageDesk()
  if (!result.success) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Staff Message Desk unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">{result.error}</p>
      </main>
    )
  }
  const { records, assignees, inboundTexts } = result.data
  const visibleRecords = records.filter((record) =>
    matchesFilter(record.status, selectedFilter)
  )
  const openCount = records.filter((record) => record.status !== "closed").length

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 overflow-y-auto p-4 lg:p-6">
      <header className="border-b pb-5">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link href="/dashboard/projects">
            <IconArrowLeft className="size-4" />
            Office maintenance
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <IconPhone className="size-6 text-muted-foreground" />
              <h1 className="text-2xl font-semibold tracking-tight">Staff Message Desk</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Capture a call for one accountable staff member, or manually route an inbound text after review.
            </p>
          </div>
          <Badge variant="secondary">{openCount} open · {records.length} total</Badge>
        </div>
      </header>

      <section className="border-b pb-6" aria-labelledby="new-staff-message">
        <h2 id="new-staff-message" className="text-lg font-semibold">New call or message</h2>
        {assignees.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No active internal staff member is available to receive a message.</p>
        ) : (
          <form action={submitCreateStaffMessage} className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Source
              <select name="sourceType" required defaultValue="call" className={fieldClassName()}>
                <option value="call">Incoming call</option>
                <option value="message">Incoming message</option>
              </select>
            </label>
            <div className="flex flex-col gap-1 text-sm font-medium">
              <span>Assign to one staff member</span>
              <SearchableStaffFormSelect assignees={assignees} />
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Caller / contact name
              <input name="callerName" required className={fieldClassName()} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Company
              <input name="callerCompany" className={fieldClassName()} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Phone
              <input name="callerPhone" type="tel" className={fieldClassName()} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Email
              <input name="callerEmail" type="email" className={fieldClassName()} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
              Subject
              <input name="subject" required className={fieldClassName()} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
              Message details
              <textarea name="body" required className="min-h-28 border bg-background p-3 text-sm" />
            </label>
            <div className="flex justify-end md:col-span-2">
              <Button type="submit">Create message and notify recipient</Button>
            </div>
          </form>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="active-staff-messages">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
          <div className="flex items-center gap-2">
            <IconInbox className="size-5 text-muted-foreground" />
            <h2 id="active-staff-messages" className="text-lg font-semibold">Message Desk records</h2>
          </div>
          <form method="get" className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Filter by status
              <select name="status" defaultValue={selectedFilter} className={fieldClassName()}>
                <option value="open">All open messages</option>
                <option value="all">All messages</option>
                {STAFF_MESSAGE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">Apply</Button>
          </form>
        </div>
        {visibleRecords.length === 0 ? (
          <div className="border border-dashed p-8 text-center text-sm text-muted-foreground">
            {records.length === 0 ? "No message records yet." : "No messages match this status filter."}
          </div>
        ) : visibleRecords.map((record) => (
          <article id={`message-${record.id}`} key={record.id} className="border bg-background p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{record.subject}</h3>
                  <Badge variant="outline">{record.sourceType === "call" ? "Call" : "Message"}</Badge>
                  <Badge variant={record.status === "closed" ? "secondary" : "default"}>
                    {staffMessageStatusLabel(record.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {record.callerName}
                  {record.callerCompany ? ` · ${record.callerCompany}` : ""}
                  {record.callerPhone ? ` · ${record.callerPhone}` : ""}
                  {record.callerEmail ? ` · ${record.callerEmail}` : ""}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">Assigned to {record.assigneeName} · {timestamp(record.createdAt)}</p>
            </div>
            <p className="mt-4 whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6">{record.body}</p>
            <form action={submitUpdateStaffMessageStatus} className="mt-4 flex flex-wrap items-end justify-end gap-2 border-t pt-4">
              <input type="hidden" name="recordId" value={record.id} />
              <label className="flex min-w-48 flex-col gap-1 text-sm font-medium">
                Status
                <select name="status" defaultValue={record.status} className={fieldClassName()}>
                  {STAFF_MESSAGE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="outline">Update status</Button>
            </form>
          </article>
        ))}
      </section>

      <section className="space-y-4 border-t pt-6" aria-labelledby="inbound-text-routing">
        <div className="flex items-center gap-2 border-b pb-2">
          <IconInbox className="size-5 text-muted-foreground" />
          <div>
            <h2 id="inbound-text-routing" className="text-lg font-semibold">Inbound texts awaiting review</h2>
            <p className="text-sm text-muted-foreground">Routing is manual. Creating a Desk record does not claim or process the GoTo event.</p>
          </div>
        </div>
        {inboundTexts.length === 0 ? (
          <div className="border border-dashed p-8 text-center text-sm text-muted-foreground">No unhandled inbound texts.</div>
        ) : inboundTexts.map((item) => (
          <article key={item.id} className="border bg-background p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">Text sender ending {item.senderPhone.replace(/\D/g, "").slice(-4) || "unknown"}</h3>
                <p className="text-sm text-muted-foreground">{timestamp(item.receivedAt)}</p>
              </div>
              <Badge variant="secondary">Needs review</Badge>
            </div>
            <p className="mt-4 whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6">
              {item.messageBody ?? "No message body was retained."}
            </p>
            {assignees.length > 0 ? (
              <form action={submitRouteGotoTextToMessageDesk} className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
                <input type="hidden" name="eventId" value={item.id} />
                <div className="flex flex-1 flex-col gap-1 text-sm font-medium">
                  <span>Route to one staff member</span>
                  <SearchableStaffFormSelect assignees={assignees} />
                </div>
                <Button type="submit">Route to Message Desk</Button>
              </form>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  )
}
