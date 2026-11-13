"use client"

/**
 * "Held job emails" on the Staff Message Desk: emails to a job's Compass
 * inbox that Compass held for a person to check. Each row shows when it came,
 * who sent it, the job, the subject, a preview and why it was held; opening a
 * row shows the whole email and the actions (post to job messages, make an
 * RFI, dismiss).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { IconChevronDown } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  dismissInboundEmail,
  postHeldJobEmailToJob,
  routeInboundEmailToRfi,
} from "@/app/actions/inbound-email-review"
import { FoldedGroup } from "@/components/folded-groups"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { HeldJobEmail, HeldJobEmailProject } from "@/lib/email/held-job-emails"
import { cn } from "@/lib/utils"

function receivedLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

function jobLabel(project: HeldJobEmailProject): string {
  return project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name
}

function senderLabel(item: HeldJobEmail): string {
  const name = item.fromName?.trim()
  return name && name !== item.fromAddress ? `${name} <${item.fromAddress}>` : item.fromAddress
}

function HeldEmailRow({
  item,
  projects,
  expanded,
  onExpand,
}: {
  readonly item: HeldJobEmail
  readonly projects: readonly HeldJobEmailProject[]
  readonly expanded: boolean
  readonly onExpand: () => void
}): React.ReactElement {
  const router = useRouter()
  const [projectId, setProjectId] = React.useState(item.suggestedProjectId ?? "")
  const [pending, startTransition] = React.useTransition()
  const projectOptions = React.useMemo(
    () => projects.map((project) => ({ value: project.id, label: jobLabel(project), description: project.projectNumber ?? undefined })),
    [projects],
  )

  function run(action: () => Promise<{ readonly success: true } | { readonly success: false; readonly error: string }>, done: string): void {
    startTransition(async () => {
      const result = await action()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(done)
      router.refresh()
    })
  }

  function post(): void {
    startTransition(async () => {
      const result = await postHeldJobEmailToJob({ emailId: item.id, projectId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.data.filesLeftOut
          ? "Posted to job messages. Any attached files stayed in the original email."
          : "Posted to job messages.",
      )
      router.refresh()
    })
  }

  const job = item.project ? jobLabel(item.project) : "No job matched"
  return (
    <article id={`held-email-${item.id}`} className="border-b px-3 py-3 last:border-b-0">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={onExpand} aria-expanded={expanded}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words font-semibold">{item.subject || "(No subject)"}</h3>
            {item.isRfi ? <Badge variant="outline">RFI</Badge> : null}
            <Badge variant="outline" className="border-warning text-warning">{item.reason.label}</Badge>
          </div>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {senderLabel(item)} · {job}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Received {receivedLabel(item.receivedAt)}</p>
          {expanded ? null : <p className="mt-1 line-clamp-2 text-sm">{item.preview}</p>}
        </div>
        <IconChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
      </button>

      {expanded ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-2">
            {item.toAddress ? <p className="break-words text-xs text-muted-foreground">Sent to {item.toAddress}</p> : null}
            <p className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm leading-6">{item.body}</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="text-sm font-medium" id={`held-email-job-${item.id}`}>Job</span>
              <SearchableCombobox
                className="h-9 w-full bg-background"
                value={projectId}
                onValueChange={(value) => {
                  if (value) setProjectId(value)
                }}
                options={projectOptions}
                ariaLabel={`Job for ${item.subject || "held email"}`}
                placeholder="Select a job…"
                searchPlaceholder="Search jobs..."
                emptyMessage="No matching jobs."
                disabled={pending}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending || !projectId} onClick={post}>
                Post to job messages
              </Button>
              {item.isRfi ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !projectId}
                  onClick={() => run(() => routeInboundEmailToRfi({ emailId: item.id, projectId }), "RFI created.")}
                >
                  Make RFI
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => dismissInboundEmail({ emailId: item.id }), "Email dismissed.")}
              >
                Dismiss
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Posting notifies the job&apos;s assigned staff, or you if no one on the job can be notified.
            </p>
          </div>
        </div>
      ) : null}
    </article>
  )
}

/** The folded "Held job emails (N)" group; it opens on its own when linked to. */
export function HeldJobEmails({
  items,
  projects,
  defaultOpen,
}: {
  readonly items: readonly HeldJobEmail[]
  readonly projects: readonly HeldJobEmailProject[]
  readonly defaultOpen: boolean
}): React.ReactElement {
  const [open, setOpen] = React.useState(defaultOpen)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  return (
    <div id="held-job-emails" className="scroll-mt-4">
      <FoldedGroup
        title={`Held job emails (${items.length})`}
        count={items.length}
        pills={items.length > 0 ? [{ label: "Needs review", tone: "attention" }] : []}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      >
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No job emails are waiting for review.</p>
        ) : (
          <div>
            {items.map((item) => (
              <HeldEmailRow
                key={item.id}
                item={item}
                projects={projects}
                expanded={expandedId === item.id}
                onExpand={() => setExpandedId((current) => (current === item.id ? null : item.id))}
              />
            ))}
          </div>
        )}
      </FoldedGroup>
    </div>
  )
}
