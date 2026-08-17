export const dynamic = "force-dynamic"

import Link from "next/link"
import { redirect } from "next/navigation"
import { IconArrowLeft, IconInbox, IconPhone } from "@tabler/icons-react"

import {
  getStaffMessageDesk,
  submitCreateStaffMessageRecord,
  submitUpdateStaffMessageRecord,
} from "@/app/actions/staff-message-desk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StaffMessageArchiveDialog } from "@/components/office/staff-message-archive-dialog"
import { STAFF_MESSAGE_STATUSES } from "@/lib/staff-message-desk"

function timestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusVariant(
  status: string
): "default" | "secondary" | "outline" {
  if (status === "Completed") return "secondary"
  if (status === "In Progress") return "default"
  return "outline"
}

function fieldClassName(): string {
  return "h-10 border bg-background px-3 text-sm"
}

export default async function StaffMessageDeskPage(): Promise<React.ReactElement> {
  const result = await getStaffMessageDesk()
  if (!result.success) redirect("/dashboard/access-restricted")
  const { records, assignees, inboundTexts, canDelete } = result.data

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 overflow-y-auto p-4 lg:p-6">
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
              Capture incoming calls and messages, give each item one accountable staff owner, and keep the handoff history intact.
            </p>
          </div>
          <Badge variant="secondary">{records.length} active records</Badge>
        </div>
      </header>

      <section className="border-b pb-6" aria-labelledby="new-staff-message">
        <h2 id="new-staff-message" className="text-lg font-semibold">New intake</h2>
        <form action={submitCreateStaffMessageRecord} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Source
            <select name="sourceType" required defaultValue="call" className={fieldClassName()}>
              <option value="call">Incoming call</option>
              <option value="message">Incoming message</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Assign to
            <select name="assigneeUserId" required defaultValue="" className={fieldClassName()}>
              <option value="" disabled>Select one active staff member…</option>
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
          <label className="flex flex-col gap-1 text-sm font-medium">
            Follow-up due
            <input name="followUpDueDate" type="date" className={fieldClassName()} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Link GoTo text review
            <select name="gotoInboundEventId" defaultValue="" className={fieldClassName()}>
              <option value="">No linked text</option>
              {inboundTexts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.senderPhone} · {timestamp(item.receivedAt)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end md:col-span-2">
            <Button type="submit">Create staff message record</Button>
          </div>
        </form>
      </section>

      <section className="space-y-4" aria-labelledby="active-staff-messages">
        <div className="flex items-center gap-2 border-b pb-2">
          <IconInbox className="size-5 text-muted-foreground" />
          <h2 id="active-staff-messages" className="text-lg font-semibold">Active message records</h2>
        </div>
        {records.length === 0 ? (
          <div className="border border-dashed p-8 text-center text-sm text-muted-foreground">
            No active staff message records.
          </div>
        ) : records.map((record) => (
          <article id={`message-${record.id}`} key={record.id} className="border bg-background p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{record.subject}</h3>
                  <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
                  <Badge variant="outline">{record.sourceType === "call" ? "Call" : "Message"}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {record.callerName}{record.callerCompany ? ` · ${record.callerCompany}` : ""}
                  {record.callerPhone ? ` · ${record.callerPhone}` : ""}
                  {record.callerEmail ? ` · ${record.callerEmail}` : ""}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">Updated {timestamp(record.updatedAt)}</p>
            </div>
            <p className="mt-4 whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6">{record.body}</p>
            <form action={submitUpdateStaffMessageRecord} className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-4">
              <input type="hidden" name="recordId" value={record.id} />
              <label className="flex flex-col gap-1 text-sm font-medium">
                Status
                <select name="status" defaultValue={record.status} className={fieldClassName()}>
                  {STAFF_MESSAGE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Assignee
                <select name="assigneeUserId" required defaultValue={record.assigneeUserId} className={fieldClassName()}>
                  {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Follow-up due
                <input name="followUpDueDate" type="date" defaultValue={record.followUpDueDate ?? ""} className={fieldClassName()} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Completion outcome
                <input name="completionOutcome" defaultValue={record.completionOutcome ?? ""} className={fieldClassName()} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium md:col-span-3">
                Update note
                <input name="note" className={fieldClassName()} placeholder="Why did this change?" />
              </label>
              <div className="flex items-end justify-end">
                <Button type="submit">Save update</Button>
              </div>
            </form>
            <div className="mt-4 border-t pt-4">
              <h4 className="text-sm font-semibold">Immutable activity history</h4>
              <ol className="mt-2 space-y-2 text-xs text-muted-foreground">
                {record.history.map((event) => (
                  <li key={event.id}>
                    <span className="font-medium text-foreground">{event.actorName}</span>{" "}
                    {event.action.replaceAll("_", " ")} · {timestamp(event.createdAt)}
                    {event.note ? ` · ${event.note}` : ""}
                  </li>
                ))}
              </ol>
            </div>
            {canDelete ? (
              <div className="mt-4 flex justify-end border-t pt-3">
                <StaffMessageArchiveDialog recordId={record.id} />
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  )
}
