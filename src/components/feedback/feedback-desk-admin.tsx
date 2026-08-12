"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconBrandGithub,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  runFeedbackAdminMaintenance,
  setFeedbackGithubIssueCreationApproval,
  updateFeedbackAdminItem,
  type FeedbackAdminOverview,
} from "@/app/actions/feedback-admin"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  FEEDBACK_DESK_STATUSES,
  FEEDBACK_PRIORITIES,
  feedbackIsResolved,
  feedbackStatusLabel,
  knownFeedbackPriority,
  knownFeedbackStatus,
} from "@/lib/jarvis/feedback-lifecycle"
import { feedbackOperationsSummary } from "@/lib/jarvis/feedback-operations-summary"

function formatDate(value: string | null): string {
  if (!value) return "Never"
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function RequestEditor({
  item,
  assignees,
}: Readonly<{
  item: FeedbackAdminOverview["items"][number]
  assignees: FeedbackAdminOverview["assignees"]
}>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [approvalPending, startApprovalTransition] = useTransition()
  const [status, setStatus] = useState(knownFeedbackStatus(item.status))
  const [priority, setPriority] = useState(knownFeedbackPriority(item.priority))
  const [assignee, setAssignee] = useState(item.assignedToUserId ?? "")
  const [message, setMessage] = useState("")
  const [issueUrl, setIssueUrl] = useState(item.githubIssueUrl ?? "")
  const [prUrl, setPrUrl] = useState(item.githubDraftPullRequestUrl ?? "")

  function save(): void {
    startTransition(async () => {
      const result = await updateFeedbackAdminItem({
        id: item.id,
        status,
        priority,
        assignedToUserId: assignee || null,
        message: message || undefined,
        githubIssueUrl: issueUrl,
        draftPullRequestUrl: prUrl,
      })
      if (!result.success) {
        toast.error(result.error ?? "Request update failed")
        return
      }
      if (!result.changed) {
        toast.info("No changes to save")
        return
      }
      setMessage("")
      toast.success(
        result.requesterUpdateQueued
          ? "Request updated; requester update queued"
          : "Request updated",
      )
      router.refresh()
    })
  }

  function setGithubCreationApproval(approved: boolean): void {
    startApprovalTransition(async () => {
      const result = await setFeedbackGithubIssueCreationApproval({
        id: item.id,
        approved,
      })
      if (!result.success) {
        toast.error(result.error ?? "GitHub approval update failed")
        return
      }
      toast.success(
        approved
          ? "New GitHub issue approved; run reconciliation when ready"
          : "New GitHub issue approval removed",
      )
      router.refresh()
    })
  }

  return (
    <Card className={item.overdue ? "border-destructive/60" : undefined}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{item.title}</CardTitle>
            <CardDescription>
              {item.reporterName ?? "Unknown requester"} · {item.source} · {formatDate(item.createdAt)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.overdue && <Badge variant="destructive">SLA overdue</Badge>}
            {!item.assignedToUserId && <Badge variant="outline">Unassigned</Badge>}
            {!item.githubIssueUrl && item.githubIssueCreationApprovedAt && (
              <Badge>New GitHub issue approved</Badge>
            )}
            {!item.githubIssueUrl &&
              !item.githubIssueCreationApprovedAt &&
              !feedbackIsResolved(item.status) && (
              <Badge variant="outline">GitHub review needed</Badge>
            )}
            {!item.githubIssueUrl &&
              !item.githubIssueCreationApprovedAt &&
              feedbackIsResolved(item.status) && (
              <Badge variant="outline">No GitHub issue required</Badge>
            )}
            <Badge variant="secondary">{item.kind}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {item.description}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-xs font-medium">
            Status
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(event) => setStatus(knownFeedbackStatus(event.target.value))}
            >
              {FEEDBACK_DESK_STATUSES.map((value) => (
                <option key={value} value={value}>{feedbackStatusLabel(value)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Priority
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={priority}
              onChange={(event) => setPriority(knownFeedbackPriority(event.target.value))}
            >
              {FEEDBACK_PRIORITIES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Owner
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">Unassigned</option>
              {assignees.map((value) => (
                <option key={value.id} value={value.id}>{value.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            GitHub issue
            <input
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              type="url"
              value={issueUrl}
              onChange={(event) => setIssueUrl(event.target.value)}
              placeholder="https://github.com/.../issues/..."
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Pull request
            <input
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              type="url"
              value={prUrl}
              onChange={(event) => setPrUrl(event.target.value)}
              placeholder="https://github.com/.../pull/..."
            />
          </label>
        </div>
        {!item.githubIssueUrl && !feedbackIsResolved(item.status) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3">
            <p className="max-w-3xl text-xs text-muted-foreground">
              If this work already exists, paste its GitHub issue or pull request above and save.
              Approve a new issue only when the request is genuinely untracked.
            </p>
            <Button
              size="sm"
              variant={item.githubIssueCreationApprovedAt ? "outline" : "secondary"}
              disabled={approvalPending}
              onClick={() => setGithubCreationApproval(!item.githubIssueCreationApprovedAt)}
            >
              <IconBrandGithub />
              {approvalPending
                ? "Updating..."
                : item.githubIssueCreationApprovedAt
                  ? "Remove issue approval"
                  : "Approve new issue"}
            </Button>
          </div>
        )}
        <label className="block space-y-1 text-xs font-medium">
          Requester update (optional)
          <textarea
            className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Explain what changed or what information is needed."
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>SLA target: {formatDate(item.slaTargetAt)}</span>
          <div className="flex items-center gap-3">
            {item.githubIssueUrl && (
              <Link className="inline-flex items-center gap-1 hover:text-foreground" href={item.githubIssueUrl} target="_blank">
                Issue <IconExternalLink className="size-3" />
              </Link>
            )}
            {item.githubDraftPullRequestUrl && (
              <Link className="inline-flex items-center gap-1 hover:text-foreground" href={item.githubDraftPullRequestUrl} target="_blank">
                PR <IconExternalLink className="size-3" />
              </Link>
            )}
            <Button size="sm" disabled={pending} onClick={save}>
              {pending ? "Saving..." : "Save / Queue update"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function FeedbackDeskAdmin({ overview }: Readonly<{
  overview: FeedbackAdminOverview
}>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const openItems = overview.items.filter(
    (item) => item.status !== "closed" && item.status !== "deployed",
  )
  const overdue = openItems.filter((item) => item.overdue).length
  const unassigned = openItems.filter((item) => !item.assignedToUserId).length
  const operations = feedbackOperationsSummary({
    bridgeFailedEvents: overview.bridge.failed,
    items: overview.items,
  })
  const githubReviewNeeded = overview.items.filter(
    (item) =>
      !item.githubIssueUrl &&
      !item.githubIssueCreationApprovedAt &&
      !feedbackIsResolved(item.status),
  ).length
  const githubCreationApproved = overview.items.filter(
    (item) =>
      !item.githubIssueUrl &&
      item.githubIssueCreationApprovedAt &&
      !feedbackIsResolved(item.status),
  ).length

  function reconcile(): void {
    startTransition(async () => {
      const result = await runFeedbackAdminMaintenance()
      if (!result.success) {
        toast.error(result.error ?? "Reconciliation failed")
        return
      }
      toast.success("Feedback reconciliation completed")
      router.refresh()
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Compass operations</p>
          <h1 className="text-2xl font-semibold tracking-tight">Feedback Desk</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organization-wide triage, ownership, requester communication, and bridge health.
          </p>
        </div>
        <Button variant="outline" disabled={pending} onClick={reconcile}>
          <IconRefresh className={pending ? "animate-spin" : undefined} />
          {pending ? "Reconciling..." : "Reconcile now"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardHeader><CardDescription>Open</CardDescription><CardTitle>{openItems.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Unassigned</CardDescription><CardTitle>{unassigned}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>SLA overdue</CardDescription><CardTitle>{overdue}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Failed bridge events</CardDescription><CardTitle>{overview.bridge.failed}</CardTitle></CardHeader></Card>
      </div>

      <Card className={operations.needsAttention ? "border-destructive/60" : undefined}>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Operations queue</CardTitle>
            <Badge variant={operations.needsAttention ? "destructive" : "secondary"}>
              {operations.needsAttention ? "Action required" : "Current"}
            </Badge>
          </div>
          <CardDescription>{operations.attentionMessage}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">Bug workflow</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {operations.openBugs} open bug{operations.openBugs === 1 ? "" : "s"}. Routine bugs can continue through protected triage and review without waiting for a leadership decision.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">Feature decision queue</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {operations.featureDecisionMessage}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">GitHub link preview</CardTitle>
          <CardDescription>
            {githubReviewNeeded} request{githubReviewNeeded === 1 ? "" : "s"} need review · {githubCreationApproved} approved for new issue creation
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Reconciliation will synchronize existing links, but it will not create a missing
          GitHub issue until an administrator approves that request below.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle health</CardTitle>
          <CardDescription>
            Pending {overview.bridge.pending} · Processing {overview.bridge.processing} · Oldest pending {formatDate(overview.bridge.oldestPendingAt)}
          </CardDescription>
          {overview.lastMaintenance && (
            <CardDescription>
              Last reconciliation {overview.lastMaintenance.status} · {formatDate(overview.lastMaintenance.completedAt ?? overview.lastMaintenance.startedAt)}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {overview.health.length === 0 && (
            <p className="text-sm text-muted-foreground">No service heartbeat has been recorded yet.</p>
          )}
          {overview.health.map((service) => (
            <div key={service.serviceName} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{service.serviceName}</span>
                <Badge variant={service.status === "healthy" && !service.stale ? "secondary" : "destructive"}>
                  {service.stale ? "stale" : service.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Heartbeat {formatDate(service.lastHeartbeatAt)}</p>
              {service.lastError && <p className="mt-1 text-xs text-destructive">{service.lastError}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {overview.items.map((item) => (
          <RequestEditor key={item.id} item={item} assignees={overview.assignees} />
        ))}
      </div>
    </div>
  )
}
