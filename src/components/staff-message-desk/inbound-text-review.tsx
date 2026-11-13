/**
 * Inbound texts waiting for review, with full routing for staff who manage
 * the project registry: route a text to a job (to-do, log or message),
 * dismiss or trash it, or hand it to one person on the Message Desk. Moved
 * here from the retired "Inbound activity review" page.
 */
import {
  dismissInboundSms,
  type InboundSmsReviewQueue,
  type InboundSmsTaskAssignee,
  routeInboundSms,
} from "@/app/actions/inbound-sms-review"
import {
  submitRouteGotoTextToMessageDesk,
  type StaffMessageAssigneeDto,
} from "@/app/actions/staff-message-desk"
import { InboundSmsProjectCombobox } from "@/components/goto/inbound-sms-project-combobox"
import { InboundSmsRoutingFields } from "@/components/goto/inbound-sms-routing-fields"
import { InboundSmsRouteSubmitButton } from "@/components/goto/inbound-sms-route-submit-button"
import { TrashInboundSmsButton } from "@/components/goto/trash-inbound-sms-button"
import { SearchableComboboxField } from "@/components/searchable-combobox"
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

function reviewLabel(item: InboundSmsReviewQueue["items"][number]): string {
  if (item.reviewReason === "ambiguous_project") return "Ambiguous project"
  if (item.reviewReason === "routing_review" && item.suggestedProjectId) return "Project pre-populated"
  if (item.reviewReason === "legacy_project_unmatched") return "Earlier unmatched text"
  return item.suggestedProjectId ? "Destination needed" : "Project needed"
}

export function InboundTextReviewList({
  queue,
  taskAssignees,
  deskAssignees,
}: {
  readonly queue: InboundSmsReviewQueue
  readonly taskAssignees: readonly InboundSmsTaskAssignee[]
  readonly deskAssignees: readonly StaffMessageAssigneeDto[]
}): React.ReactElement {
  if (queue.items.length === 0) {
    return <div className="border border-dashed p-8 text-center text-sm text-muted-foreground">No unhandled inbound texts.</div>
  }
  return (
    <>
      {queue.items.map((item) => (
        <article id={`inbound-sms-${item.id}`} key={item.id} className="border bg-background p-4 shadow-sm">
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
            <Badge variant={item.suggestedProjectId ? "default" : "outline"}>{reviewLabel(item)}</Badge>
          </div>

          {item.messageBody ? (
            <p className="mt-4 whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6">{item.messageBody}</p>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              {item.recoveryError ?? "Compass is recovering the content of this earlier unmatched text from GoTo."}
              {" "}You can add a useful title and description manually if needed.
            </p>
          )}

          <form action={routeInboundSms} className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2">
            <input type="hidden" name="eventId" value={item.id} />
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor={`inbound-sms-project-${item.id}`}>Project</label>
              <InboundSmsProjectCombobox
                id={`inbound-sms-project-${item.id}`}
                projects={queue.projects}
                defaultValue={item.suggestedProjectId}
              />
            </div>
            <InboundSmsRoutingFields assignees={taskAssignees} />
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
              <InboundSmsRouteSubmitButton />
            </div>
          </form>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <form action={dismissInboundSms}>
              <input type="hidden" name="eventId" value={item.id} />
              <Button type="submit" variant="outline">Dismiss from Compass</Button>
            </form>
            <TrashInboundSmsButton eventId={item.id} senderPhone={item.senderPhone} />
          </div>
          {deskAssignees.length > 0 ? (
            <form
              action={submitRouteGotoTextToMessageDesk}
              className="mt-2 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-end sm:justify-end"
            >
              <input type="hidden" name="eventId" value={item.id} />
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium sm:max-w-sm">
                Route to one staff member
                <SearchableComboboxField
                  name="assigneeUserId"
                  required
                  className="font-normal"
                  options={deskAssignees.map((assignee) => ({
                    value: assignee.id,
                    label: assignee.name,
                    description: assignee.email,
                  }))}
                  ariaLabel="Route text to staff member"
                  placeholder="Select one staff recipient…"
                  searchPlaceholder="Search staff..."
                  emptyMessage="No matching staff."
                />
              </label>
              <Button type="submit" variant="outline">Route to Message Desk</Button>
            </form>
          ) : null}
        </article>
      ))}
    </>
  )
}
