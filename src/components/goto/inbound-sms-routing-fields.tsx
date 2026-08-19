"use client"

import { useState } from "react"

import type { InboundSmsTaskAssignee } from "@/app/actions/inbound-sms-review"
import { isInboundSmsTodoDestination } from "@/lib/goto/review-routing"

type Destination =
  | ""
  | "rfi"
  | "rfq"
  | "change_order"
  | "todo"
  | "delivery"
  | "daily_log"
  | "video"

export function InboundSmsRoutingFields({
  assignees,
}: {
  readonly assignees: readonly InboundSmsTaskAssignee[]
}): React.ReactElement {
  const [destination, setDestination] = useState<Destination>("")
  const taskDestination = isInboundSmsTodoDestination(destination)

  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Destination
        <select
          name="destination"
          required
          value={destination}
          onChange={(event) => {
            const value = event.target.value
            if (
              value === "" ||
              value === "rfi" ||
              value === "rfq" ||
              value === "change_order" ||
              value === "todo" ||
              value === "delivery" ||
              value === "daily_log" ||
              value === "video"
            ) {
              setDestination(value)
            }
          }}
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

      {taskDestination ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Assignee
            <select
              name="assigneeUserId"
              required
              defaultValue=""
              className="h-10 border bg-background px-3 font-normal"
            >
              <option value="" disabled>Select staff assignee…</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.name} · {assignee.email}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Due date
            <input
              type="date"
              name="dueDate"
              required
              className="h-10 border bg-background px-3 font-normal"
            />
          </label>
          <p className="text-xs text-muted-foreground md:col-span-2">
            Dated to-dos appear in All to-dos and remain available on the
            project’s To-dos page.
          </p>
        </>
      ) : null}
    </>
  )
}
