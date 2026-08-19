export const dynamic = "force-dynamic"

import Link from "next/link"
import {
  IconArrowLeft,
  IconInbox,
  IconMailForward,
  IconMessage,
} from "@tabler/icons-react"

import {
  getStaffMessageAssignees,
  submitRouteGotoTextToMessageDesk,
} from "@/app/actions/staff-message-desk"
import {
  dismissInboundEmail,
  getInboundEmailReviewQueue,
  routeInboundEmailToRfi,
} from "@/app/actions/inbound-email-review"
import {
  dismissInboundSms,
  getInboundSmsReviewQueue,
  routeInboundSms,
} from "@/app/actions/inbound-sms-review"
import { TrashInboundSmsButton } from "@/components/goto/trash-inbound-sms-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function receivedLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function suggestedTitle(value: string | null): string {
  const firstLine = value?.split(/\r?\n/, 1)[0]?.trim() ?? ""
  return firstLine.slice(0, 120)
}

export default async function InboundEmailReviewPage(): Promise<React.ReactElement> {
  const [queue, smsQueue, staffAssignees] = await Promise.all([
    getInboundEmailReviewQueue(),
    getInboundSmsReviewQueue(),
    getStaffMessageAssignees(),
  ])

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 lg:p-6">
      <header className="border-b pb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link href="/dashboard/projects">
            <IconArrowLeft className="size-4" />
            Project Hub
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <IconInbox className="size-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Inbound activity review
          </h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Route email and text messages that Compass could not assign
          confidently. The original intake record remains available for audit.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center gap-2 border-b pb-2">
          <IconMessage className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Text messages awaiting review</h2>
          <Badge variant="secondary">{smsQueue.items.length}</Badge>
        </div>
        {smsQueue.items.length === 0 ? (
          <div className="border border-dashed p-6 text-center text-sm text-muted-foreground">
            No text messages need review.
          </div>
        ) : (
          smsQueue.items.map((item) => (
            <article
              id={`inbound-sms-${item.id}`}
              key={item.id}
              className="border bg-background p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{item.senderPhone}</h3>
                  <p className="text-sm text-muted-foreground">
                    Received {receivedLabel(item.receivedAt)} at {item.ownerTouchpoint}
                    {item.attachmentCount > 0
                      ? ` · ${item.attachmentCount} attachment${item.attachmentCount === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
                <Badge variant={item.suggestedProjectId ? "default" : "outline"}>
                  {item.reviewReason === "ambiguous_project"
                    ? "Ambiguous project"
                    : item.reviewReason === "routing_review" && item.suggestedProjectId
                      ? "Project pre-populated"
                    : item.reviewReason === "legacy_project_unmatched"
                      ? "Earlier unmatched text"
                      : item.suggestedProjectId
                        ? "Destination needed"
                        : "Project needed"}
                </Badge>
              </div>

              {item.messageBody ? (
                <p className="mt-4 whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6">
                  {item.messageBody}
                </p>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  {item.recoveryError ??
                    "Compass is recovering the content of this earlier unmatched text from GoTo."}
                  {" "}You can add a useful title and description manually if needed.
                </p>
              )}

              <form
                action={routeInboundSms}
                className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2"
              >
                <input type="hidden" name="eventId" value={item.id} />
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Project
                  <select
                    name="projectId"
                    required
                    defaultValue={item.suggestedProjectId ?? ""}
                    className="h-10 border bg-background px-3 font-normal"
                  >
                    <option value="" disabled>Select project…</option>
                    {smsQueue.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.projectNumber ? `${project.projectNumber} — ` : ""}
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Destination
                  <select
                    name="destination"
                    required
                    defaultValue=""
                    className="h-10 border bg-background px-3 font-normal"
                  >
                    <option value="" disabled>Select destination…</option>
                    <option value="rfi">RFI</option>
                    <option value="rfq">RFQ draft</option>
                    <option value="change_order">Change-order draft</option>
                    <option value="todo">To-do</option>
                    <option value="delivery">Delivery to-do</option>
                    <option value="daily_log">Daily log</option>
                    <option value="video">Video review</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
                  Title
                  <input
                    name="title"
                    required
                    defaultValue={suggestedTitle(item.messageBody)}
                    className="h-10 border bg-background px-3 font-normal"
                    placeholder="Describe the incoming item"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
                  Message
                  <textarea
                    name="messageBody"
                    required
                    defaultValue={item.messageBody ?? ""}
                    className="min-h-28 border bg-background p-3 font-normal"
                    placeholder="Enter or restore the message details"
                  />
                </label>
                <div className="flex justify-end md:col-span-2">
                  <Button type="submit">Route to Compass</Button>
                </div>
              </form>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <form action={dismissInboundSms}>
                  <input type="hidden" name="eventId" value={item.id} />
                  <Button type="submit" variant="outline">Dismiss from Compass</Button>
                </form>
                <TrashInboundSmsButton
                  eventId={item.id}
                  senderPhone={item.senderPhone}
                />
              </div>
              {staffAssignees.success && staffAssignees.data.length > 0 ? (
                <form
                  action={submitRouteGotoTextToMessageDesk}
                  className="mt-2 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-end sm:justify-end"
                >
                  <input type="hidden" name="eventId" value={item.id} />
                  <label className="flex flex-1 flex-col gap-1 text-sm font-medium sm:max-w-sm">
                    Route to Message Desk
                    <select
                      name="assigneeUserId"
                      required
                      defaultValue=""
                      className="h-10 border bg-background px-3 font-normal"
                    >
                      <option value="" disabled>Select one staff recipient…</option>
                      {staffAssignees.data.map((assignee) => (
                        <option key={assignee.id} value={assignee.id}>
                          {assignee.name} · {assignee.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit" variant="outline">Route to Message Desk</Button>
                </form>
              ) : null}
            </article>
          ))
        )}
      </section>

      <div className="flex items-center gap-2 border-b pb-2">
        <IconMailForward className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Email awaiting review</h2>
        <Badge variant="secondary">{queue.items.length}</Badge>
      </div>

      {queue.items.length === 0 ? (
        <section className="border border-dashed p-8 text-center">
          <h2 className="mt-3 font-semibold">No email needs review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Confident project matches will create their tagged Compass record automatically.
          </p>
        </section>
      ) : (
        <section className="space-y-3">
          {queue.items.map((item) => (
            <article
              id={`inbound-${item.id}`}
              key={item.id}
              className="border bg-background p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{item.subject}</h2>
                    <Badge variant={item.kind === "rfi" ? "default" : "secondary"}>
                      {item.kind === "rfi" ? "RFI" : "Unclassified"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    From {item.fromName ?? item.fromAddress} · {receivedLabel(item.receivedAt)}
                  </p>
                  {item.toAddress ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Delivered to {item.toAddress}
                    </p>
                  ) : null}
                </div>
              </div>

              <p className="mt-4 whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6">
                {item.bodyPreview}
              </p>

              <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
                {item.kind === "rfi" ? (
                  <form action={routeInboundEmailToRfi} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                    <input type="hidden" name="emailId" value={item.id} />
                    <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                      Project
                      <select
                        name="projectId"
                        required
                        defaultValue={item.suggestedProjectId ?? ""}
                        className="h-10 border bg-background px-3 font-normal"
                      >
                        <option value="" disabled>Select project…</option>
                        {queue.projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.projectNumber ? `${project.projectNumber} — ` : ""}
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit">Create RFI</Button>
                  </form>
                ) : (
                  <p className="flex-1 text-sm text-muted-foreground">
                    Add a supported subject tag before routing this email.
                  </p>
                )}
                <form action={dismissInboundEmail}>
                  <input type="hidden" name="emailId" value={item.id} />
                  <Button type="submit" variant="outline">Dismiss</Button>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
