"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconCircleCheck, IconRefresh, IconSend } from "@tabler/icons-react"
import { toast } from "sonner"

import { sendProjectToSage } from "@/app/actions/project-sage-send"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import type { ProjectSageStatus, SageClientChoice } from "@/lib/domain/sage-bridge/project-send-rules"

const SENDING_REFRESH_MS = 5_000

/**
 * The Overview's Sage line for office staff: linked job number, a job on its
 * way, or why Sage didn't take it with a button to send it again.
 */
export function ProjectSageStatusLine({
  projectId,
  status,
}: {
  readonly projectId: string
  readonly status: ProjectSageStatus
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [chosen, setChosen] = React.useState<SageClientChoice | null>(null)

  // The PC writer usually finishes within a minute; refresh until it reports back.
  useVisibleInterval(() => router.refresh(), SENDING_REFRESH_MS, {
    enabled: status.kind === "sending",
    immediate: false,
  })

  function send(client: SageClientChoice | null): void {
    startTransition(async () => {
      const result = await sendProjectToSage(
        projectId,
        client ? { sageRecordId: client.sageRecordId, sageClientNumber: client.sageClientNumber } : null,
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sent to Sage. This updates when Sage finishes.")
      router.refresh()
    })
  }

  if (status.kind === "linked") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="secondary" className="gap-1">
          <IconCircleCheck className="size-3.5" />
          Sage job #{status.jobNumber}
        </Badge>
        {status.statusName ? <span className="text-muted-foreground">{status.statusName}</span> : null}
      </div>
    )
  }

  if (status.kind === "sending") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className="gap-1">
          <IconRefresh className="size-3.5 animate-spin" />
          Sending to Sage…
        </Badge>
      </div>
    )
  }

  if (status.kind === "not_linked") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline">Not linked to Sage</Badge>
      </div>
    )
  }

  const needsClient = status.clientChoices.length > 0
  return (
    <div className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm print:hidden">
      <div className="flex items-start gap-2">
        <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="font-medium">Not in Sage yet</p>
          <p className="text-muted-foreground">{status.reason}</p>
        </div>
      </div>
      {needsClient ? (
        <div className="space-y-1.5 pl-6">
          {status.clientChoices.map((choice) => (
            <label key={choice.sageRecordId} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`sage-client-${projectId}`}
                checked={chosen?.sageRecordId === choice.sageRecordId}
                onChange={() => setChosen(choice)}
              />
              <span>
                Sage client #{choice.sageClientNumber} · {choice.name}
                <span className="text-muted-foreground"> · {choice.email ?? "no email"}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="pl-6">
        <Button
          type="button"
          size="sm"
          disabled={pending || (needsClient && !chosen)}
          onClick={() => send(needsClient ? chosen : null)}
        >
          {pending ? <IconRefresh className="size-4 animate-spin" /> : <IconSend className="size-4" />}
          {needsClient ? "Use this client and send to Sage" : "Send to Sage"}
        </Button>
      </div>
    </div>
  )
}
