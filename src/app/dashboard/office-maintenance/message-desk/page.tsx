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
  type StaffMessageStatus,
} from "@/lib/staff-message-desk"

type StaffMessageFilter = "open" | "all" | StaffMessageStatus

const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

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

function monthFilter(value: string | undefined): number | null {
  if (!value) return null
  const month = Number(value)
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null
}

function yearFilter(value: string | undefined): number | null {
  if (!value) return null
  const year = Number(value)
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null
}

function recordDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export default async function StaffMessageDeskPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly month?: string
    readonly status?: string
    readonly year?: string
  }>
}): Promise<React.ReactElement> {
  const query = await searchParams
  const selectedFilter = messageFilter(query.status)
  const selectedMonth = monthFilter(query.month)
  const selectedYear = yearFilter(query.year)
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
  const availableYears = Array.from(
    new Set(
      records.flatMap((record) => {
        const date = recordDate(record.createdAt)
        return date ? [date.getFullYear()] : []
      })
    )
  ).sort((left, right) => right - left)
  const visibleRecords = records.filter((record) => {
    if (!matchesFilter(record.status, selectedFilter)) return false
    const date = recordDate(record.createdAt)
    if (!date) return selectedMonth === null && selectedYear === null
    if (selectedMonth !== null && date.getMonth() + 1 !== selectedMonth) return false
    return selectedYear === null || date.getFullYear() === selectedYear
  })
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
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Status
              <select name="status" defaultValue={selectedFilter} className={fieldClassName()}>
                <option value="open">All open messages</option>
                <option value="all">All messages</option>
                {STAFF_MESSAGE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Month
              <select name="month" defaultValue={selectedMonth ?? ""} className={fieldClassName()}>
                <option value="">All months</option>
                {MONTH_OPTIONS.map((month, index) => (
                  <option key={month} value={index + 1}>{month}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Year
              <select name="year" defaultValue={selectedYear ?? ""} className={fieldClassName()}>
                <option value="">All years</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">Apply</Button>
          </form>
        </div>
        {visibleRecords.length === 0 ? (
          <div className="border border-dashed p-8 text-center text-sm text-muted-foreground">
            {records.length === 0 ? "No message records yet." : "No messages match these filters."}
          </div>
        ) : (
          <div className="overflow-x-auto border bg-background shadow-sm">
            <table className="w-full min-w-[1050px] border-collapse text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="border-b px-3 py-2 font-medium">Received</th>
                  <th scope="col" className="border-b px-3 py-2 font-medium">Contact</th>
                  <th scope="col" className="border-b px-3 py-2 font-medium">Message</th>
                  <th scope="col" className="border-b px-3 py-2 font-medium">Assigned to</th>
                  <th scope="col" className="border-b px-3 py-2 font-medium">Type</th>
                  <th scope="col" className="border-b px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((record) => (
                  <tr id={`message-${record.id}`} key={record.id} className="align-top hover:bg-muted/30">
                    <td className="whitespace-nowrap border-b px-3 py-3 text-xs text-muted-foreground">
                      {timestamp(record.createdAt)}
                    </td>
                    <td className="border-b px-3 py-3">
                      <p className="font-medium">{record.callerName}</p>
                      {record.callerCompany ? <p className="text-xs text-muted-foreground">{record.callerCompany}</p> : null}
                      {record.callerPhone ? <p className="text-xs text-muted-foreground">{record.callerPhone}</p> : null}
                      {record.callerEmail ? <p className="text-xs text-muted-foreground">{record.callerEmail}</p> : null}
                    </td>
                    <td className="max-w-md border-b px-3 py-3">
                      <p className="font-medium">{record.subject}</p>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                        {record.body}
                      </p>
                    </td>
                    <td className="border-b px-3 py-3">{record.assigneeName}</td>
                    <td className="border-b px-3 py-3">
                      <Badge variant="outline">{record.sourceType === "call" ? "Call" : "Message"}</Badge>
                    </td>
                    <td className="border-b px-3 py-3">
                      <form action={submitUpdateStaffMessageStatus} className="flex items-center gap-2">
                        <input type="hidden" name="recordId" value={record.id} />
                        <label className="sr-only" htmlFor={`status-${record.id}`}>Status</label>
                        <select
                          id={`status-${record.id}`}
                          name="status"
                          defaultValue={record.status}
                          className="h-9 min-w-44 border bg-background px-2 text-sm"
                        >
                          {STAFF_MESSAGE_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <Button type="submit" variant="outline" size="sm">Update</Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
              <Badge asChild variant="secondary">
                <Link
                  href={`/dashboard/office-maintenance/inbound-email#inbound-sms-${encodeURIComponent(item.id)}`}
                >
                  Needs review
                </Link>
              </Badge>
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
