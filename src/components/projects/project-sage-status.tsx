"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconCirclePlus, IconLink, IconRefresh, IconSend } from "@tabler/icons-react"
import { toast } from "sonner"

import { createProjectInSage, linkProjectToExistingSageJob, sendProjectToSage } from "@/app/actions/project-sage-send"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { SageNumberBadge } from "@/components/sage-number-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import type {
  ProjectSageStatus,
  SageClientChoice,
  SageJobCreatePreview,
  SageJobCreateSelection,
} from "@/lib/domain/sage-bridge/project-send-rules"

const SENDING_REFRESH_MS = 5_000

/**
 * The Overview's Sage line for office staff: linked job number, a job on its
 * way, why Sage didn't take it with a button to send it again, or Create in
 * Sage for a job that was never sent. A job already in Sage is linked by its
 * Sage job number instead.
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
        <SageNumberBadge label="Sage job" number={status.jobNumber} />
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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">Not linked to Sage</Badge>
        <LinkExistingSageJob projectId={projectId} />
        {status.create ? (
          <CreateInSage projectId={projectId} preview={status.create} />
        ) : status.createBlocker ? (
          <span className="text-muted-foreground">{status.createBlocker}</span>
        ) : null}
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
      <div className="flex flex-wrap gap-2 pl-6">
        <LinkExistingSageJob projectId={projectId} />
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

function selectionKey(selection: SageJobCreateSelection | null): string {
  if (!selection) return ""
  return selection.kind === "new_client" ? "new" : `${selection.sageRecordId}:${selection.sageClientNumber}`
}

/** Create in Sage: confirms the Sage job name, client and job type, then queues the job write. */
function CreateInSage({
  projectId,
  preview,
}: {
  readonly projectId: string
  readonly preview: SageJobCreatePreview
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [selection, setSelection] = React.useState<SageJobCreateSelection | null>(null)
  const client = preview.client
  const needsChoice = client.kind === "choose"

  function create(): void {
    startTransition(async () => {
      const result = await createProjectInSage(projectId, needsChoice ? selection : null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      toast.success("Sent to Sage. This updates when Sage finishes.")
      router.refresh()
    })
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="print:hidden" onClick={() => setOpen(true)}>
        <IconCirclePlus className="size-4" />
        Create in Sage
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create this job in Sage?</AlertDialogTitle>
            <AlertDialogDescription>
              Compass sends this job to Sage once. If it&apos;s already in Sage under another name, don&apos;t create
              it here; use Link existing Sage job instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Sage job name</dt>
            <dd className="font-medium">{preview.jobName}</dd>
            <dt className="text-muted-foreground">Client</dt>
            <dd>
              {preview.clientName}
              {client.kind === "linked" ? (
                <span className="text-muted-foreground"> · Sage client #{client.sageClientNumber}</span>
              ) : client.kind === "new" ? (
                <span className="text-muted-foreground"> · added to Sage as a new client</span>
              ) : null}
            </dd>
            <dt className="text-muted-foreground">Job type</dt>
            <dd>{preview.jobTypeName}</dd>
            <dt className="text-muted-foreground">Job status</dt>
            <dd>{preview.jobStatusName}</dd>
          </dl>
          {client.kind === "choose" ? (
            <fieldset className="space-y-1.5 text-sm">
              <legend className="mb-1.5 font-medium">Sage has clients with a matching name. Which one is this?</legend>
              {client.choices.map((choice: SageClientChoice) => {
                const value: SageJobCreateSelection = {
                  kind: "sage_client", sageRecordId: choice.sageRecordId, sageClientNumber: choice.sageClientNumber,
                }
                return (
                  <label key={choice.sageRecordId} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name={`sage-create-client-${projectId}`}
                      checked={selectionKey(selection) === selectionKey(value)}
                      onChange={() => setSelection(value)}
                    />
                    <span>
                      Sage client #{choice.sageClientNumber} · {choice.name}
                      <span className="text-muted-foreground"> · {choice.email ?? "no email"}</span>
                    </span>
                  </label>
                )
              })}
              {client.allowNew ? (
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`sage-create-client-${projectId}`}
                    checked={selection?.kind === "new_client"}
                    onChange={() => setSelection({ kind: "new_client" })}
                  />
                  <span>None of these: add {preview.clientName} to Sage as a new client</span>
                </label>
              ) : null}
            </fieldset>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="button" disabled={pending || (needsChoice && !selection)} onClick={create}>
              {pending ? <IconRefresh className="size-4 animate-spin" /> : <IconSend className="size-4" />}
              Create in Sage
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Link existing Sage job: for a job already in Sage, record its Sage job number instead of creating it again. */
function LinkExistingSageJob({ projectId }: { readonly projectId: string }): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [jobNumber, setJobNumber] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const inputId = `sage-link-job-${projectId}`

  function link(): void {
    startTransition(async () => {
      const result = await linkProjectToExistingSageJob(projectId, jobNumber)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      toast.success(`Linked to Sage job ${jobNumber.trim()}.`)
      router.refresh()
    })
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="print:hidden" onClick={() => setOpen(true)}>
        <IconLink className="size-4" />
        Link existing Sage job
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Link to a job already in Sage</AlertDialogTitle>
            <AlertDialogDescription>
              Enter the job&apos;s number from Sage. Nothing is created or changed in Sage; Compass records the
              number so change orders, estimates and billing go to that job.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>Sage job number</Label>
            <Input
              id={inputId}
              inputMode="numeric"
              placeholder="722"
              value={jobNumber}
              disabled={pending}
              onChange={(event) => setJobNumber(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && jobNumber.trim()) { event.preventDefault(); link() } }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="button" disabled={pending || !jobNumber.trim()} onClick={link}>
              {pending ? <IconRefresh className="size-4 animate-spin" /> : <IconLink className="size-4" />}
              Link job
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
