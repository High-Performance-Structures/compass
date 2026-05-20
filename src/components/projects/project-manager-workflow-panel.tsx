"use client"

import Link from "next/link"
import { type ReactElement, type ReactNode } from "react"
import {
  IconAddressBook,
  IconCalendarStats,
  IconChevronRight,
  IconFolder,
  IconFileDollar,
  IconHomeShare,
  IconMessageCircleQuestion,
  IconPhotoCheck,
  IconReceipt,
  IconShoppingCart,
} from "@tabler/icons-react"

import type { ProjectBudgetSummary } from "@/app/actions/project-budget"
import type { ProjectContactsSummary } from "@/app/actions/project-contacts"
import type { ProjectFieldSummary } from "@/app/actions/project-field"
import type { ProjectOperationsSummary } from "@/app/actions/project-operations"
import type { ProjectRfiSummary } from "@/app/actions/project-rfis"
import { Badge } from "@/components/ui/badge"
import {
  PROJECT_WORKFLOW_ROLE_LENSES,
  roleLensForId,
  type ProjectWorkflowRoleId,
  type ProjectWorkspaceMode,
  type WorkflowStepId,
} from "@/lib/project-workflow-roles"
import { cn } from "@/lib/utils"

type WorkflowTone =
  | "project"
  | "schedule"
  | "people"
  | "field"
  | "owner"
  | "money"
  | "google"
  | "procurement"
  | "admin"

type WorkflowStep = {
  readonly id: WorkflowStepId
  readonly label: string
  readonly href: string
  readonly eyebrow: string
  readonly status: string
  readonly detail: string
  readonly icon: ReactNode
  readonly tone: WorkflowTone
  readonly urgent: boolean
}

function reviewCount(summary: ProjectContactsSummary | null): number {
  if (!summary) return 0
  return summary.unmatchedSourceCount + summary.reviewSourceCount
}

function scheduleStatus(
  totalTaskCount: number,
  pastDueCount: number,
  operationsSummary: ProjectOperationsSummary | null,
): string {
  if (pastDueCount > 0) return `${pastDueCount} overdue`
  if (operationsSummary?.nextScheduleItem) return "Next item ready"
  if (totalTaskCount > 0) return `${totalTaskCount} tasks`
  return "Needs schedule"
}

function scheduleDetail(
  totalTaskCount: number,
  operationsSummary: ProjectOperationsSummary | null,
): string {
  if (operationsSummary?.nextScheduleItem) {
    return operationsSummary.nextScheduleItem.title
  }
  if (totalTaskCount > 0) {
    return "Open the Sage-backed schedule view."
  }
  return "Import or create the working schedule."
}

function contactsStatus(summary: ProjectContactsSummary | null): string {
  if (!summary) return "Unavailable"
  const needsReview = reviewCount(summary)
  if (needsReview > 0) return `${needsReview} to review`
  if (summary.totalCount > 0) return `${summary.totalCount} mapped`
  return "Needs contacts"
}

function contactsDetail(summary: ProjectContactsSummary | null): string {
  if (!summary) return "Contact mapping is not available."
  const needsReview = reviewCount(summary)
  if (needsReview > 0) {
    return "Resolve Sage, schedule, or Buildertrend names."
  }
  if (summary.pendingAssignmentSourceCount > 0) {
    return `${summary.pendingAssignmentSourceCount} TBD names are parked until assigned.`
  }
  return "Owners, subs, suppliers, and internal contacts are grouped."
}

function fieldStatus(summary: ProjectFieldSummary | null): string {
  if (!summary) return "Unavailable"
  if (summary.photosAwaitingReviewCount > 0) {
    return `${summary.photosAwaitingReviewCount} photos`
  }
  if (summary.latestDailyLog) return "Latest log ready"
  return "Needs field input"
}

function fieldDetail(summary: ProjectFieldSummary | null): string {
  if (!summary) return "Daily log and photo status is not available."
  if (summary.photosAwaitingReviewCount > 0) {
    return "Review visibility before owner or sub/vendor sharing."
  }
  if (summary.latestDailyLog) {
    return summary.latestDailyLog.workCompleted
  }
  return "Daily logs and photos will feed owner updates."
}

function ownerStatus(summary: ProjectFieldSummary | null): string {
  if (!summary) return "Unavailable"
  if (summary.draftOwnerUpdateCount > 0) {
    return `${summary.draftOwnerUpdateCount} draft`
  }
  if (summary.latestOwnerUpdate) return "Preview ready"
  if (summary.approvedDailyLogCount > 0 || summary.ownerVisiblePhotoCount > 0) {
    return "Ready to draft"
  }
  return "Waiting"
}

function ownerDetail(summary: ProjectFieldSummary | null): string {
  if (!summary) return "Owner update status is not available."
  if (summary.latestOwnerUpdate) return summary.latestOwnerUpdate.title
  if (summary.approvedDailyLogCount > 0 || summary.ownerVisiblePhotoCount > 0) {
    return "Use approved logs, photos, and the next schedule item."
  }
  return "Approve field content before publishing."
}

function budgetStatus(summary: ProjectBudgetSummary | null): string {
  if (!summary || summary.allLines.length === 0) return "Needs Sage budget"
  if (summary.currentApplication) {
    return `Pay app ${summary.currentApplication.applicationNumber}`
  }
  return `${summary.allLines.length} lines`
}

function budgetDetail(summary: ProjectBudgetSummary | null): string {
  if (!summary || summary.allLines.length === 0) {
    return "Map the Sage/G703 budget snapshot."
  }
  return summary.detailMode === "category"
    ? "Owner view is rolled up by category."
    : "Internal detail and owner-visible cost codes are available."
}

function intakeStatus(summary: ProjectFieldSummary | null): string {
  if (!summary) return "Unavailable"
  if (summary.photoReviewFolder) return "Drive linked"
  if (summary.dailyLogCount > 0 || summary.photoCount > 0)
    return "Intake active"
  return "Ready for intake"
}

function intakeDetail(summary: ProjectFieldSummary | null): string {
  if (!summary) return "Google intake status is not available."
  if (summary.photoReviewFolder) {
    return "Staged photos, logs, and script-fed records land in review."
  }
  return "Google scripts can feed Compass; Compass owns review and visibility."
}

function rfiStatus(summary: ProjectRfiSummary | null): string {
  if (!summary) return "Unavailable"
  if (summary.openCount > 0) return `${summary.openCount} open`
  return "No open RFIs"
}

function rfiDetail(summary: ProjectRfiSummary | null): string {
  if (!summary) return "RFI details are not available."
  if (summary.nextDue) return summary.nextDue.subject
  return "Prepare RFIs, RFQs, and scope questions from this project context."
}

function purchaseOrderStatus(summary: ProjectOperationsSummary | null): string {
  if (!summary) return "Unavailable"
  if (summary.openPurchaseOrderCount > 0) {
    return `${summary.openPurchaseOrderCount} open PO`
  }
  return "No open POs"
}

function purchaseOrderDetail(summary: ProjectOperationsSummary | null): string {
  if (!summary) return "Purchase order details are not available."
  if (summary.purchaseOrders[0]) return summary.purchaseOrders[0].title
  return "Prepare PO requests and keep Sage commitments visible."
}

function billsAndDrawsStatus(summary: ProjectBudgetSummary | null): string {
  if (!summary || summary.allLines.length === 0) return "Needs Sage budget"
  if (summary.currentApplication) {
    return `Pay app ${summary.currentApplication.applicationNumber}`
  }
  return "Ready for billing"
}

function billsAndDrawsDetail(summary: ProjectBudgetSummary | null): string {
  if (!summary || summary.allLines.length === 0) {
    return "Map Sage budget data before owner draws or pay applications."
  }
  return "Enter vendor bills, then prepare owner draws/pay applications."
}

function stepClassName(tone: WorkflowTone, urgent: boolean): string {
  if (urgent) {
    return "border-amber-300 bg-amber-50/80 text-amber-950 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
  }

  switch (tone) {
    case "project":
      return "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/20"
    case "schedule":
      return "border-sky-200 bg-sky-50/80 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/20"
    case "people":
      return "border-violet-200 bg-violet-50/80 hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/20"
    case "field":
      return "border-lime-200 bg-lime-50/80 hover:bg-lime-100 dark:border-lime-900/60 dark:bg-lime-950/20"
    case "owner":
      return "border-rose-200 bg-rose-50/80 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/20"
    case "money":
      return "border-teal-200 bg-teal-50/80 hover:bg-teal-100 dark:border-teal-900/60 dark:bg-teal-950/20"
    case "google":
      return "border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/20"
    case "procurement":
      return "border-orange-200 bg-orange-50/80 hover:bg-orange-100 dark:border-orange-900/60 dark:bg-orange-950/20"
    case "admin":
      return "border-slate-200 bg-slate-50/80 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/20"
  }
}

function orderedWorkflowSteps(
  steps: readonly WorkflowStep[],
  priority: readonly WorkflowStepId[],
): readonly WorkflowStep[] {
  const ordered: WorkflowStep[] = []

  for (const stepId of priority) {
    const matchingStep = steps.find((step) => step.id === stepId)
    if (matchingStep) ordered.push(matchingStep)
  }

  for (const step of steps) {
    if (!ordered.some((orderedStep) => orderedStep.id === step.id)) {
      ordered.push(step)
    }
  }

  return ordered
}

function WorkflowCard({
  step,
  number,
}: {
  readonly step: WorkflowStep
  readonly number: number
}): ReactElement {
  return (
    <Link
      href={step.href}
      className={`group relative flex min-h-44 flex-col justify-between rounded-lg border p-4 shadow-sm transition-all duration-200 hover:-translate-y-1.5 hover:shadow-lg ${stepClassName(step.tone, step.urgent)}`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-background/80 text-xs font-semibold shadow-sm">
              {number}
            </span>
            <span className="text-muted-foreground">{step.icon}</span>
          </div>
          <Badge variant={step.urgent ? "secondary" : "outline"}>
            {step.status}
          </Badge>
        </div>
        <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
          {step.eyebrow}
        </p>
        <h2 className="mt-1 text-base font-semibold">{step.label}</h2>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {step.detail}
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm font-medium">
        <span>Open</span>
        <IconChevronRight className="size-4 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  )
}

export function ProjectManagerWorkflowPanel({
  projectId,
  projectNumber,
  totalTaskCount,
  pastDueCount,
  operationsSummary,
  contactsSummary,
  fieldSummary,
  budgetSummary,
  rfiSummary,
  activeRoleId,
  onActiveRoleChange,
  workspaceMode,
  canUseDeveloperMode,
  allowedRoleIds,
}: {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly totalTaskCount: number
  readonly pastDueCount: number
  readonly operationsSummary: ProjectOperationsSummary | null
  readonly contactsSummary: ProjectContactsSummary | null
  readonly fieldSummary: ProjectFieldSummary | null
  readonly budgetSummary: ProjectBudgetSummary | null
  readonly rfiSummary: ProjectRfiSummary | null
  readonly activeRoleId: ProjectWorkflowRoleId
  readonly onActiveRoleChange: (roleId: ProjectWorkflowRoleId) => void
  readonly workspaceMode: ProjectWorkspaceMode
  readonly canUseDeveloperMode: boolean
  readonly allowedRoleIds: readonly ProjectWorkflowRoleId[]
}): ReactElement {
  const activeRole = roleLensForId(activeRoleId)
  const availableRoles = PROJECT_WORKFLOW_ROLE_LENSES.filter((role) =>
    allowedRoleIds.includes(role.id)
  )
  const modeBadge =
    workspaceMode === "developer" && canUseDeveloperMode
      ? "Developer mode"
      : activeRole.badge
  const needsContactReview = reviewCount(contactsSummary) > 0
  const steps: readonly WorkflowStep[] = [
    {
      id: "context",
      label: "Confirm context",
      href: "/dashboard/projects",
      eyebrow: projectNumber ?? "Project search",
      status: "Switch job",
      detail:
        "You are already in this job. Use this only when you need to jump to another project.",
      icon: <IconFolder className="size-5" />,
      tone: "project",
      urgent: false,
    },
    {
      id: "schedule",
      label: "Review schedule",
      href: `/dashboard/projects/${projectId}/schedule`,
      eyebrow: "Sage-backed plan",
      status: scheduleStatus(totalTaskCount, pastDueCount, operationsSummary),
      detail: scheduleDetail(totalTaskCount, operationsSummary),
      icon: <IconCalendarStats className="size-5" />,
      tone: "schedule",
      urgent: pastDueCount > 0 || totalTaskCount === 0,
    },
    {
      id: "contacts",
      label: "Confirm contacts",
      href: needsContactReview
        ? `/dashboard/projects/${projectId}/contacts/review`
        : `/dashboard/projects/${projectId}/contacts`,
      eyebrow: "Owners, subs, suppliers",
      status: contactsStatus(contactsSummary),
      detail: contactsDetail(contactsSummary),
      icon: <IconAddressBook className="size-5" />,
      tone: "people",
      urgent: needsContactReview,
    },
    {
      id: "field",
      label: "Review field input",
      href: `/dashboard/projects/${projectId}/daily-logs`,
      eyebrow: "Logs and photos",
      status: fieldStatus(fieldSummary),
      detail: fieldDetail(fieldSummary),
      icon: <IconPhotoCheck className="size-5" />,
      tone: "field",
      urgent: (fieldSummary?.photosAwaitingReviewCount ?? 0) > 0,
    },
    {
      id: "rfqs",
      label: "Prepare RFIs / RFQs",
      href: `/dashboard/projects/${projectId}/rfis`,
      eyebrow: "Questions and bid scopes",
      status: rfiStatus(rfiSummary),
      detail: rfiDetail(rfiSummary),
      icon: <IconMessageCircleQuestion className="size-5" />,
      tone: "procurement",
      urgent: (rfiSummary?.openCount ?? 0) > 0,
    },
    {
      id: "purchase-orders",
      label: "Prepare purchase orders",
      href: `/dashboard/projects/${projectId}/purchase-orders`,
      eyebrow: "Sage commitments",
      status: purchaseOrderStatus(operationsSummary),
      detail: purchaseOrderDetail(operationsSummary),
      icon: <IconShoppingCart className="size-5" />,
      tone: "procurement",
      urgent: false,
    },
    {
      id: "owner-update",
      label: "Prepare owner update",
      href: `/dashboard/projects/${projectId}/owner-updates`,
      eyebrow: "Approved publish path",
      status: ownerStatus(fieldSummary),
      detail: ownerDetail(fieldSummary),
      icon: <IconHomeShare className="size-5" />,
      tone: "owner",
      urgent: false,
    },
    {
      id: "bills-draws",
      label: "Bills and owner draws",
      href: `/dashboard/financials?tab=bills`,
      eyebrow: "Bills / pay applications",
      status: billsAndDrawsStatus(budgetSummary),
      detail: billsAndDrawsDetail(budgetSummary),
      icon: <IconReceipt className="size-5" />,
      tone: "money",
      urgent: !budgetSummary || budgetSummary.allLines.length === 0,
    },
    {
      id: "budget",
      label: "Budget / G703",
      href: `/dashboard/projects/${projectId}/budget`,
      eyebrow: "Sage snapshot",
      status: budgetStatus(budgetSummary),
      detail: budgetDetail(budgetSummary),
      icon: <IconFileDollar className="size-5" />,
      tone: "money",
      urgent: !budgetSummary || budgetSummary.allLines.length === 0,
    },
    {
      id: "intake",
      label: "Photo/script intake",
      href: `/dashboard/projects/${projectId}/photos`,
      eyebrow: "Drive and scripts",
      status: intakeStatus(fieldSummary),
      detail: intakeDetail(fieldSummary),
      icon: <IconPhotoCheck className="size-5" />,
      tone: "google",
      urgent: false,
    },
  ]
  const orderedSteps = orderedWorkflowSteps(steps, activeRole.priority)

  return (
    <section className="rounded-xl border bg-muted/25 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Role dashboard
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            Run today as {activeRole.label}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            You are already in the job. Move through the work queues that keep
            the project moving, then switch jobs only when the context changes.
          </p>
        </div>
        <Badge variant="secondary">{modeBadge}</Badge>
      </div>

      <div className="mt-4 rounded-lg border bg-background/70 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {canUseDeveloperMode ? "Preview role dashboard" : "Your role dashboard"}
          </p>
          {canUseDeveloperMode && (
            <Badge variant="outline">Admin preview</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {availableRoles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => onActiveRoleChange(role.id)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                activeRoleId === role.id
                  ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50 hover:text-foreground",
              )}
            >
              {role.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm font-medium">{activeRole.label} lens</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeRole.focus}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {orderedSteps.map((step, index) => (
          <WorkflowCard key={step.label} step={step} number={index + 1} />
        ))}
      </div>

      <div className="mt-4 rounded-lg border bg-background/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Role lenses
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Next step: let each internal role see its own version of this
              workflow.
            </p>
          </div>
          <Badge variant="outline">
            {workspaceMode === "developer" && canUseDeveloperMode
              ? "Developer tools visible"
              : "Worker mode first"}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {availableRoles.map((role) => (
            <div key={role.label} className="rounded-md border bg-muted/20 p-3">
              <p className="text-sm font-medium">{role.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {role.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
