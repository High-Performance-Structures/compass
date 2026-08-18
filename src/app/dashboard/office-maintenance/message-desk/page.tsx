export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconInbox, IconPhone } from "@tabler/icons-react"

import {
  getStaffMessageDesk,
  submitCreateStaffMessage,
  submitRouteGotoTextToMessageDesk,
} from "@/app/actions/staff-message-desk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function fieldClassName(): string {
  return "h-10 border bg-background px-3 text-sm"
}

function timestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export default async function StaffMessageDeskPage(): Promise<React.ReactElement> {
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
          <Badge variant="secondary">{records.length} messages</Badge>
        </div>
      </header>

      <section className="border-b pb-6" aria-labelledby="new-staff-message">
        <h2 id="new-staff-message" className="text-lg font-semibold">New call or message</h2>
        {assignees.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No other active internal staff member is available to receive a message.</p>
        ) : (
          <form action={submitCreateStaffMessage} className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Source
              <select name="sourceType" required defaultValue="call" className={fieldClassName()}>
                <option value="call">Incoming call</option>
                <option value="message">Incoming message</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Assign to one staff member
              <select name="assigneeUserId" required defaultValue="" className={fieldClassName()}>
                <option value="" disabled>Select a recipient…</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>{assignee.name} · {assignee.email}</option>
                ))}
              </select>
            </label>
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
        <div className="flex items-center gap-2 border-b pb-2">
          <IconInbox className="size-5 text-muted-foreground" />
          <h2 id="active-staff-messages" className="text-lg font-semibold">Message Desk records</h2>
        </div>
        {records.length === 0 ? (
          <div className="border border-dashed p-8 text-center text-sm text-muted-foreground">No message records yet.</div>
        ) : records.map((record) => (
          <article id={`message-${record.id}`} key={record.id} className="border bg-background p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{record.subject}</h3>
                  <Badge variant="outline">{record.sourceType === "call" ? "Call" : "Message"}</Badge>
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
                <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                  Route to one staff member
                  <select name="assigneeUserId" required defaultValue="" className={fieldClassName()}>
                    <option value="" disabled>Select a recipient…</option>
                    {assignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>{assignee.name} · {assignee.email}</option>
                    ))}
                  </select>
                </label>
                <Button type="submit">Route to Message Desk</Button>
              </form>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  )
}
