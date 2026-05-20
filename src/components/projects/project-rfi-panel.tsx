import Link from "next/link"
import {
  IconAlertCircle,
  IconExternalLink,
  IconEye,
  IconMessageQuestion,
  IconUsers,
} from "@tabler/icons-react"

import type {
  ProjectRfiItem,
  ProjectRfiSummary,
} from "@/app/actions/project-rfis"
import { Badge } from "@/components/ui/badge"

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function audienceLabel(value: string): string {
  switch (value) {
    case "sub_vendor":
      return "Sub/vendor"
    case "owner":
      return "Owner"
    case "public":
      return "Public"
    case "internal":
      return "Internal"
    default:
      return statusLabel(value)
  }
}

function isActiveRfiStatus(status: string): boolean {
  return !["complete", "closed", "void", "cancelled"].includes(
    status.toLowerCase()
  )
}

function RfiMetric({
  icon,
  label,
  value,
}: {
  readonly icon: React.ReactNode
  readonly label: string
  readonly value: number
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold leading-none">{value}</p>
    </div>
  )
}

function RfiRow({
  item,
}: {
  readonly item: ProjectRfiItem
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {item.rfiNumber}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-medium">
            {item.subject}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <Badge variant={isActiveRfiStatus(item.status) ? "secondary" : "outline"}>
            {statusLabel(item.status)}
          </Badge>
          <Badge variant="outline">{audienceLabel(item.audience)}</Badge>
        </div>
      </div>

      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
        {item.question}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {item.companyName && <span>{item.companyName}</span>}
        {item.assignedToName && <span>Assigned: {item.assignedToName}</span>}
        <span>Response needed by {formatDate(item.dueDate)}</span>
      </div>
    </div>
  )
}

export function ProjectRfiPanel({
  projectId,
  summary,
}: {
  readonly projectId: string
  readonly summary: ProjectRfiSummary | null
}): React.ReactElement {
  if (!summary) {
    return (
      <section className="rounded-lg border p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <IconMessageQuestion className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">RFIs</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          RFI details are unavailable for this project.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconMessageQuestion className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">RFIs</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Questions, answers, and visibility for owner/sub/vendor previews.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/projects/${projectId}/rfis`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Manage RFIs
            <IconExternalLink className="size-4" />
          </Link>
          <Link
            href={`/dashboard/projects/${projectId}/preview/sub-vendor`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <IconUsers className="size-4" />
            Sub/vendor view
          </Link>
          <Link
            href={`/dashboard/projects/${projectId}/preview/owner`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <IconEye className="size-4" />
            Owner view
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <RfiMetric
          icon={<IconMessageQuestion className="size-4" />}
          label="Open"
          value={summary.openCount}
        />
        <RfiMetric
          icon={<IconAlertCircle className="size-4" />}
          label="High priority"
          value={summary.highPriorityCount}
        />
        <RfiMetric
          icon={<IconUsers className="size-4" />}
          label="Sub/vendor"
          value={summary.subVendorVisibleCount}
        />
        <RfiMetric
          icon={<IconEye className="size-4" />}
          label="Owner"
          value={summary.ownerVisibleCount}
        />
      </div>

      {summary.nextDue && (
        <div className="mt-4 rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Next response needed
          </p>
          <p className="mt-1 text-sm font-medium">{summary.nextDue.subject}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.nextDue.rfiNumber}
            {summary.nextDue.companyName
              ? ` · ${summary.nextDue.companyName}`
              : ""}
            {" · Due "}
            {formatDate(summary.nextDue.dueDate)}
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {summary.items.length > 0 ? (
          summary.items.map((item) => <RfiRow key={item.id} item={item} />)
        ) : (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            No RFIs have been mapped to this project yet.
          </p>
        )}
      </div>
    </section>
  )
}
