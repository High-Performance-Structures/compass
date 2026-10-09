"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconBrandGithub, IconExternalLink, IconRefresh } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  runFeedbackAdminMaintenance,
  setFeedbackFeaturePriorityApproval,
  setFeedbackGithubIssueCreationApproval,
  updateFeedbackAdminItem,
  type FeedbackAdminOverview,
} from "@/app/actions/feedback-admin"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  FEEDBACK_DESK_STATUSES,
  FEEDBACK_PRIORITIES,
  feedbackIsResolved,
  feedbackStatusLabel,
  knownFeedbackPriority,
  knownFeedbackStatus,
} from "@/lib/jarvis/feedback-lifecycle"
import {
  feedbackDeskQueueItems,
  feedbackDeskQueueViews,
  knownFeedbackDeskQueueGithubFilter,
  knownFeedbackDeskQueueViewId,
  type FeedbackDeskQueueGithubFilter,
  type FeedbackDeskQueueViewId,
} from "@/lib/jarvis/feedback-desk-queue"
import { feedbackOperationsSummary } from "@/lib/jarvis/feedback-operations-summary"
import { PageHeader } from "@/components/page-header"
import { cn } from "@/lib/utils"

function formatDate(value: string | null): string {
  if (!value) return "Not set"
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
  const [priorityApprovalPending, startPriorityApprovalTransition] = useTransition()
  const [status, setStatus] = useState(knownFeedbackStatus(item.status))
  const [priority, setPriority] = useState(knownFeedbackPriority(item.priority))
  const [assignee, setAssignee] = useState(item.assignedToUserId ?? "")
  const [internalSummary, setInternalSummary] = useState(item.internalSummary ?? "")
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
        internalSummary,
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

  function setFeaturePriorityApproval(approved: boolean): void {
    startPriorityApprovalTransition(async () => {
      const result = await setFeedbackFeaturePriorityApproval({
        id: item.id,
        approved,
      })
      if (!result.success) {
        toast.error(result.error ?? "Feature priority decision update failed")
        return
      }
      toast.success(
        approved
          ? "Feature priority approved; implementation may now proceed through protected gates"
          : "Feature priority approval removed",
      )
      router.refresh()
    })
  }

  return (
    <section
      aria-label="Selected request"
      className={cn("space-y-4 border-t pt-4", item.overdue && "border-l-2 border-l-destructive pl-4")}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{item.title}</h3>
            <p className="text-sm text-muted-foreground">
              {item.reporterName ?? "Unknown requester"} · {item.source} · Submitted {formatDate(item.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.kind === "feature" && item.featurePriorityApprovedAt && (
              <Badge>Leadership priority approved</Badge>
            )}
            {item.overdue && <Badge variant="destructive">Response target passed</Badge>}
            {!item.assignedToUserId && <Badge variant="outline">Unassigned</Badge>}
            {!item.githubIssueUrl && item.githubIssueCreationApprovedAt && (
              <Badge>New GitHub issue approved</Badge>
            )}
            {!item.githubIssueUrl && !item.githubIssueCreationApprovedAt && !feedbackIsResolved(item.status) && (
              <Badge variant="outline">GitHub review needed</Badge>
            )}
            {!item.githubIssueUrl && !item.githubIssueCreationApprovedAt && feedbackIsResolved(item.status) && (
              <Badge variant="outline">No GitHub issue required</Badge>
            )}
            {item.deliveryGraphStatus === "created" && <Badge>Delivery graph attached</Badge>}
            {item.deliveryGraphStatus === "failed" && <Badge variant="destructive">Delivery graph failed</Badge>}
            <Badge variant="secondary">{item.kind}</Badge>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="border-l-2 pl-3">
          <p className="text-xs font-medium text-muted-foreground">Original request</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>
        </div>
        <label className="block space-y-1 text-xs font-medium">
          Internal summary
          <textarea
            className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={internalSummary}
            onChange={(event) => setInternalSummary(event.target.value)}
            placeholder="Summarize the request, evidence, decision, and next safe step for the internal team."
          />
          <span className="block font-normal text-muted-foreground">
            Visible only in this protected Feedback Desk. It is not sent to the requester or GitHub.
          </span>
        </label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-xs font-medium">
            Status
            <SearchableCombobox
              className="h-9"
              value={status}
              onValueChange={(value) => {
                if (value !== "") setStatus(knownFeedbackStatus(value))
              }}
              options={FEEDBACK_DESK_STATUSES.map((value) => ({ value, label: feedbackStatusLabel(value) }))}
              ariaLabel="Status"
              placeholder="Choose status"
              searchPlaceholder="Search statuses..."
              emptyMessage="No matching statuses."
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Priority
            <Select value={priority} onValueChange={(value) => setPriority(knownFeedbackPriority(value))}>
              <SelectTrigger aria-label="Priority" className="w-full font-normal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FEEDBACK_PRIORITIES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Owner
            <SearchableCombobox
              ariaLabel="Choose feedback owner"
              options={[
                { value: "", label: "Unassigned" },
                ...assignees.map((value) => ({
                  value: value.id,
                  label: value.name,
                })),
              ]}
              value={assignee}
              onValueChange={setAssignee}
              placeholder="Unassigned"
              searchPlaceholder="Search internal staff..."
              emptyMessage="No matching staff."
              groupHeading="Owners"
              className="h-9"
            />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            GitHub issue
            <input className="h-9 w-full rounded-md border bg-background px-3 text-sm" type="url" value={issueUrl} onChange={(event) => setIssueUrl(event.target.value)} placeholder="https://github.com/.../issues/..." />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Pull request
            <input className="h-9 w-full rounded-md border bg-background px-3 text-sm" type="url" value={prUrl} onChange={(event) => setPrUrl(event.target.value)} placeholder="https://github.com/.../pull/..." />
          </label>
        </div>
        {item.kind === "feature" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
            <p className="max-w-3xl text-xs text-muted-foreground">
              Features need your explicit leadership priority decision before implementation, testing, or a new GitHub issue can proceed.
            </p>
            <Button
              size="sm"
              variant={item.featurePriorityApprovedAt ? "outline" : "secondary"}
              disabled={priorityApprovalPending}
              onClick={() => setFeaturePriorityApproval(!item.featurePriorityApprovedAt)}
            >
              {priorityApprovalPending
                ? "Updating..."
                : item.featurePriorityApprovedAt
                  ? "Remove priority approval"
                  : "Approve feature priority"}
            </Button>
          </div>
        )}
        {!item.githubIssueUrl && !feedbackIsResolved(item.status) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
            <p className="max-w-3xl text-xs text-muted-foreground">
              If this work already exists, paste its GitHub issue or pull request above and save. Approve a new issue only when the request is genuinely untracked.
            </p>
            <Button size="sm" variant={item.githubIssueCreationApprovedAt ? "outline" : "secondary"} disabled={approvalPending} onClick={() => setGithubCreationApproval(!item.githubIssueCreationApprovedAt)}>
              <IconBrandGithub />
              {approvalPending ? "Updating..." : item.githubIssueCreationApprovedAt ? "Remove issue approval" : "Approve new issue"}
            </Button>
          </div>
        )}
        <label className="block space-y-1 text-xs font-medium">
          Requester update (optional)
          <textarea className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Explain what changed or what information is needed." />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Response target: {formatDate(item.slaTargetAt)}</span>
          <div className="flex items-center gap-3">
            {item.githubIssueUrl && <Link className="inline-flex items-center gap-1 hover:text-foreground" href={item.githubIssueUrl} target="_blank">Issue <IconExternalLink className="size-3" /></Link>}
            {item.githubDraftPullRequestUrl && <Link className="inline-flex items-center gap-1 hover:text-foreground" href={item.githubDraftPullRequestUrl} target="_blank">PR <IconExternalLink className="size-3" /></Link>}
            <Button size="sm" disabled={pending} onClick={save}>{pending ? "Saving..." : "Save / Queue update"}</Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export function FeedbackDeskAdmin({ overview }: Readonly<{ overview: FeedbackAdminOverview }>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [view, setView] = useState<FeedbackDeskQueueViewId>("attention")
  const [kind, setKind] = useState("all")
  const [status, setStatus] = useState("all")
  const [github, setGithub] = useState<FeedbackDeskQueueGithubFilter>("all")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const openItems = overview.items.filter((item) => !feedbackIsResolved(item.status))
  const overdue = openItems.filter((item) => item.overdue).length
  const unassigned = openItems.filter((item) => !item.assignedToUserId).length
  const operations = feedbackOperationsSummary({ bridgeFailedEvents: overview.bridge.failed, items: overview.items })
  const queueViews = feedbackDeskQueueViews(overview.items)
  const availableKinds = useMemo(() => [...new Set(overview.items.map((item) => item.kind))].sort(), [overview.items])
  const availableStatuses = useMemo(() => [...new Set(overview.items.map((item) => item.status))].sort(), [overview.items])
  const filteredItems = feedbackDeskQueueItems(overview.items, { github, kind, query, status, view })
  const selectedItem = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) {
      setSelectedId(selectedItem.id)
    }
  }, [selectedId, selectedItem])

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
      <PageHeader
        className="mb-0"
        eyebrow="Compass operations"
        title="Feedback Desk"
        actions={<Button variant="outline" disabled={pending} onClick={reconcile}><IconRefresh className={pending ? "animate-spin" : undefined} />{pending ? "Reconciling..." : "Reconcile now"}</Button>}
      />

      <dl className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Open", value: openItems.length, alert: false },
          { label: "Unassigned", value: unassigned, alert: false },
          { label: "Response target passed", value: overdue, alert: overdue > 0 },
          { label: "Failed bridge events", value: overview.bridge.failed, alert: overview.bridge.failed > 0 },
        ].map((stat) => (
          <div key={stat.label} className="bg-background px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</dt>
            <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", stat.alert && "text-destructive")}>{stat.value}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3" aria-labelledby="feedback-operations-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2"><h2 id="feedback-operations-heading" className="text-base font-semibold">Operations queue</h2><Badge variant={operations.needsAttention ? "destructive" : "secondary"}>{operations.needsAttention ? "Action required" : "Current"}</Badge></div>
        <p className={cn("text-sm", operations.needsAttention ? "text-destructive" : "text-muted-foreground")}>{operations.attentionMessage.replaceAll("overdue", "past its response target")}</p>
        <div className="grid gap-px border bg-border md:grid-cols-2">
          <div className="bg-background p-3"><p className="text-sm font-medium">Bug workflow</p><p className="mt-1 text-sm text-muted-foreground">{operations.openBugs} open bug{operations.openBugs === 1 ? "" : "s"}. Routine bugs can continue through protected triage and review.</p></div>
          <div className="bg-background p-3"><p className="text-sm font-medium">Feature decision queue</p><p className="mt-1 text-sm text-muted-foreground">{operations.featureDecisionMessage}</p></div>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="feedback-queue-heading">
        <div className="border-b pb-2"><h2 id="feedback-queue-heading" className="text-base font-semibold">Request queue</h2><p className="mt-1 text-sm text-muted-foreground">Select one request to review and update. Filters keep the active list short; no request is removed by filtering.</p></div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(13rem,1.4fr)_repeat(4,minmax(0,1fr))]">
            <Select value={view} onValueChange={(value) => setView(knownFeedbackDeskQueueViewId(value))}>
              <SelectTrigger aria-label="Queue view" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {queueViews.map((queueView) => <SelectItem key={queueView.id} value={queueView.id}>{queueView.label} ({queueView.count})</SelectItem>)}
              </SelectContent>
            </Select>
            <input className="h-9 rounded-md border bg-background px-3 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search request titles" type="search" />
            <Select value={kind} onValueChange={setKind}><SelectTrigger aria-label="Request type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{availableKinds.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
            <SearchableCombobox className="h-9" value={status} onValueChange={(value) => setStatus(value || "all")} options={[{ value: "all", label: "All statuses" }, ...availableStatuses.map((value) => ({ value, label: feedbackStatusLabel(value) }))]} ariaLabel="Filter by status" placeholder="All statuses" searchPlaceholder="Search statuses..." emptyMessage="No matching statuses." />
            <Select value={github} onValueChange={(value) => setGithub(knownFeedbackDeskQueueGithubFilter(value))}><SelectTrigger aria-label="GitHub state" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All GitHub states</SelectItem><SelectItem value="linked">GitHub linked</SelectItem><SelectItem value="review">GitHub review needed</SelectItem><SelectItem value="approved">New issue approved</SelectItem></SelectContent></Select>
          </div>
        <div className="space-y-3">
          {filteredItems.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No requests match these filters. Try a broader queue or clear the search.</p> : <label className="block space-y-1 text-xs font-medium">Selected request<SearchableCombobox ariaLabel="Choose feedback request" options={filteredItems.map((item) => ({ value: item.id, label: item.title, description: `${item.kind} · ${feedbackStatusLabel(item.status)}` }))} value={selectedItem?.id ?? ""} onValueChange={setSelectedId} placeholder="Choose request" searchPlaceholder="Search requests..." emptyMessage="No matching requests." groupHeading="Requests" /></label>}
        </div>

      {selectedItem && <RequestEditor key={selectedItem.id} item={selectedItem} assignees={overview.assignees} />}
      </section>

      <section className="space-y-3" aria-labelledby="feedback-health-heading">
        <div className="border-b pb-2"><h2 id="feedback-health-heading" className="text-base font-semibold">Lifecycle health</h2><p className="mt-1 text-sm text-muted-foreground">Pending {overview.bridge.pending} · Processing {overview.bridge.processing} · Oldest pending {formatDate(overview.bridge.oldestPendingAt)}</p>{overview.lastMaintenance && <p className="text-sm text-muted-foreground">Last reconciliation {overview.lastMaintenance.status} · {formatDate(overview.lastMaintenance.completedAt ?? overview.lastMaintenance.startedAt)}</p>}</div>
        {overview.health.length === 0 ? <p className="text-sm text-muted-foreground">No service heartbeat has been recorded yet.</p> : <div className="grid gap-px border bg-border md:grid-cols-3">{overview.health.map((service) => <div key={service.serviceName} className="bg-background p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{service.serviceName}</span><Badge variant={service.status === "healthy" && !service.stale ? "secondary" : "destructive"}>{service.stale ? "stale" : service.status}</Badge></div><p className="mt-2 text-xs text-muted-foreground">Heartbeat {formatDate(service.lastHeartbeatAt)}</p>{service.lastError && <p className="mt-1 text-xs text-destructive">{service.lastError}</p>}</div>)}</div>}
      </section>
    </div>
  )
}
