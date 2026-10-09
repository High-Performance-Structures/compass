"use client"

import { useState } from "react"

import { SearchableComboboxField } from "@/components/searchable-combobox"
import type { InboundSmsTaskAssignee } from "@/app/actions/inbound-sms-review"
import { isInboundSmsTodoDestination } from "@/lib/goto/review-routing"

type Destination =
  | ""
  | "message"
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
        <SearchableComboboxField
          name="destination"
          required
          className="font-normal"
          defaultValue={destination}
          onValueChange={(value) => {
            if (
              value === "" ||
              value === "message" ||
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
          options={[
            { value: "message", label: "Project Messages" },
            { value: "rfi", label: "RFI" },
            { value: "rfq", label: "RFQ draft" },
            { value: "change_order", label: "Change-order draft" },
            { value: "todo", label: "To-do" },
            { value: "delivery", label: "Delivery to-do" },
            { value: "daily_log", label: "Daily log" },
            { value: "video", label: "Video review" },
          ]}
          ariaLabel="Destination"
          placeholder="Select destination…"
          searchPlaceholder="Search destinations..."
          emptyMessage="No matching destinations."
        />
      </label>

      {taskDestination ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Assignee
            <SearchableComboboxField
              name="assigneeUserId"
              required
              className="font-normal"
              options={assignees.map((assignee) => ({
                value: assignee.id,
                label: assignee.name,
                description: assignee.email,
              }))}
              ariaLabel="Assignee"
              placeholder="Select staff assignee…"
              searchPlaceholder="Search staff..."
              emptyMessage="No matching staff."
            />
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
