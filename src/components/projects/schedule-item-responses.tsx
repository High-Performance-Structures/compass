"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { AudienceScheduleItem } from "@/app/actions/project-audience-preview"
import {
  proposeScheduleTaskChange,
  respondToScheduleTaskAssignee,
  respondToScheduleTaskConfirmation
} from "@/app/actions/schedule-confirmations"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Response = "confirmed" | "declined" | "proposed"
type ResponseTarget = {
  readonly id: string
  readonly kind: "assignment" | "legacy"
  readonly name: string | null
  readonly status: string
  readonly canRespond: boolean
  readonly proposedStartDate: string | null
  readonly proposedWorkdays: number | null
  readonly note: string | null
}

function responseLabel(status: string): string {
  if (status === "confirmed") return "Confirmed"
  if (status === "declined") return "Cannot commit"
  if (status === "proposed") return "Change proposed"
  if (status === "pending") return "Awaiting confirmation"
  if (status === "unavailable") return "Compass account needed"
  return "Not requested"
}

function ScheduleResponse({
  item,
  target
}: {
  readonly item: AudienceScheduleItem
  readonly target: ResponseTarget
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [response, setResponse] = React.useState<Response | null>(null)
  const [startDate, setStartDate] = React.useState(item.startDate)
  const [workdays, setWorkdays] = React.useState(item.workdays)
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const prefix = React.useId()
  const openResponse = (next: Response): void => {
    setStartDate(target.proposedStartDate ?? item.startDate)
    setWorkdays(target.proposedWorkdays ?? item.workdays)
    setNote(target.note ?? "")
    setError(null)
    setResponse(next)
  }
  const submit = (): void => {
    if (response === null) return
    startTransition(async () => {
      setError(null)
      try {
        const result =
          target.kind === "assignment"
            ? await respondToScheduleTaskAssignee(target.id, {
                response,
                message: note,
                ...(response === "proposed"
                  ? { proposedStartDate: startDate, proposedWorkdays: workdays }
                  : {})
              })
            : response === "proposed"
              ? await proposeScheduleTaskChange(item.id, {
                  startDate,
                  workdays,
                  note
                })
              : await respondToScheduleTaskConfirmation(item.id, response, note)
        if (!result.success) {
          setError(result.error)
          return
        }
        toast.success(
          response === "confirmed"
            ? "Commitment confirmed."
            : "Your response was sent to the project team."
        )
        setResponse(null)
        router.refresh()
      } catch {
        setError("Unable to send your response. Please try again.")
      }
    })
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {target.name && (
          <span className="text-xs text-muted-foreground">{target.name}</span>
        )}
        <Badge
          variant={target.status === "confirmed" ? "secondary" : "outline"}
        >
          {responseLabel(target.status)}
        </Badge>
        {target.canRespond && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openResponse("confirmed")}
            >
              Confirm availability
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openResponse("declined")}
            >
              Report conflict
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openResponse("proposed")}
            >
              Suggest dates / duration
            </Button>
          </>
        )}
      </div>
      {target.proposedStartDate && (
        <p className="text-xs text-muted-foreground">
          Proposed: {target.proposedStartDate}
          {target.proposedWorkdays !== null
            ? ` · ${target.proposedWorkdays} workdays`
            : ""}{" "}
          · Awaiting team review
        </p>
      )}
      {target.note && (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
          Your note: {target.note}
        </p>
      )}
      <Dialog
        open={response !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setResponse(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {response === "proposed"
                ? "Suggest dates or duration"
                : response === "declined"
                  ? "Report a schedule conflict"
                  : "Confirm your availability"}
            </DialogTitle>
            <DialogDescription>
              {item.title}. Your response goes to the project team. Changes to
              published dates require their review and publication.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {response === "proposed" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor={`${prefix}-start`}>Start date</Label>
                  <Input
                    id={`${prefix}-start`}
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${prefix}-duration`}>
                    Duration (workdays)
                  </Label>
                  <Input
                    id={`${prefix}-duration`}
                    type="number"
                    min={1}
                    max={3650}
                    value={workdays}
                    onChange={(event) =>
                      setWorkdays(Number(event.target.value))
                    }
                  />
                </div>
              </>
            )}
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-note`}>Note (optional)</Label>
              <Textarea
                id={`${prefix}-note`}
                maxLength={1000}
                value={note}
                placeholder="Explain a conflict, delivery constraint, or other coordination detail."
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setResponse(null)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={submit}>
              {pending
                ? "Sending…"
                : response === "confirmed"
                  ? "Confirm commitment"
                  : response === "declined"
                    ? "Send conflict"
                    : "Send proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ScheduleItemResponses({
  item
}: {
  readonly item: AudienceScheduleItem
}): React.ReactElement | null {
  if (!item.confirmationRequired) return null
  const targets: readonly ResponseTarget[] =
    item.assignees.length > 0
      ? item.assignees.map((assignee) => ({
          id: assignee.id,
          kind: "assignment",
          name: assignee.displayName,
          status: assignee.responseStatus,
          canRespond: assignee.viewerCanRespond,
          proposedStartDate: assignee.proposedStartDate,
          proposedWorkdays: assignee.proposedWorkdays,
          note: assignee.responseMessage
        }))
      : [
          {
            id: item.id,
            kind: "legacy",
            name: null,
            status: item.confirmationStatus,
            canRespond: item.viewerCanConfirm,
            proposedStartDate: item.proposedStartDate,
            proposedWorkdays: item.proposedWorkdays,
            note: item.proposalNote
          }
        ]
  return (
    <div className="space-y-3">
      {targets.map((target) => (
        <ScheduleResponse key={target.id} item={item} target={target} />
      ))}
    </div>
  )
}
