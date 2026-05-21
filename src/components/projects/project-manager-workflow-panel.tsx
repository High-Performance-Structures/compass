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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  PROJECT_WORKFLOW_ROLE_LENSES,
  isProjectWorkflowRoleId,
  roleLensForId,
  type ProjectWorkflowRoleId,
  type ProjectWorkspaceMode,
  type WorkflowStepId,
} from "@/lib/project-workflow-roles"

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
    return "Open the project schedule view."
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
    return "Resolve imported schedule, accounting, or Buildertrend names."
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
  if (!summary || summary.allLines.length === 0) return "Needs budget"
  if (summary.currentApplication) {
    return `Pay app ${summary.currentApplication.applicationNumber}`
  }
  return `${summary.allLines.length} lines`
}

function budgetDetail(summary: ProjectBudgetSummary | null): string {
  if (!summary || summary.allLines.length === 0) {
    return "Add or import the budget/G703 snapshot."
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
  return "Prepare, print, email, and optionally sync purchase orders."
}

function billsAndDrawsStatus(summary: ProjectBudgetSummary | null): string {
  if (!summary || summary.allLines.length === 0) return "Needs budget"
  if (summary.currentApplication) {
    return `Pay app ${summary.currentApplication.applicationNumber}`
  }
  return "Ready for billing"
}

function billsAndDrawsDetail(summary: ProjectBudgetSummary | null): string {
  if (!summary || summary.allLines.length === 0) {
    return "Add budget data before owner draws or pay applications."
  }
  return "Enter vendor bills, then prepare owner draws/pay applications."
}

function stepAccentClassName(tone: WorkflowTone, urgent: boolean): string {
  if (urgent) {
    return "border-l-amber-500 bg-amber-50/55 dark:bg-amber-950/15"
  }

  switch (tone) {
    case "project":
      return "border-l-emerald-500"
    case "schedule":
      return "border-l-sky-500"
    case "people":
      return "border-l-violet-500"
    case "field":
      return "border-l-lime-500"
    case "owner":
      return "border-l-rose-500"
    case "money":
      return "border-l-teal-500"
    case "google":
      return "border-l-indigo-500"
    case "procurement":
      return "border-l-orange-500"
    case "admin":
      return "border-l-slate-500"
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
      className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-l-2 px-3 py-3 transition-colors hover:bg-muted/45 ${stepAccentClassName(step.tone, step.urgent)}`}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="w-5 text-right text-xs tabular-nums">{number}</span>
        <span className="flex size-8 items-center justify-center rounded-md border bg-background">
          {step.icon}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="truncate text-sm font-semibold">{step.label}</h2>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {step.eyebrow}
          </p>
        </div>
        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
          {step.detail}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={step.urgent ? "secondary" : "outline"} className="hidden sm:inline-flex">
          {step.status}
        </Badge>
        <IconChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
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
  showRoleControls = true,
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
  readonly showRoleControls?: boolean
}): ReactElement {
  const activeRole = roleLensForId(activeRoleId)
  const availableRoles = PROJECT_WORKFLOW_ROLE_LENSES.filter((role) =>
    allowedRoleIds.includes(role.id)
  )
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
      eyebrow: "Project plan",
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
      eyebrow: "Vendor commitments",
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
      eyebrow: "Budget snapshot",
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
    <section className="space-y-3">
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
      </div>

      {showRoleControls && (
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
            <Select
              value={activeRoleId}
              onValueChange={(value) => {
                if (!isProjectWorkflowRoleId(value)) return
                if (!allowedRoleIds.includes(value)) return
                onActiveRoleChange(value)
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-[240px] bg-background"
                aria-label="Select role dashboard"
              >
                <SelectValue placeholder="Choose role view" />
              </SelectTrigger>
              <SelectContent align="start">
                {availableRoles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              Viewing {activeRole.label}
            </span>
          </div>
          <p className="mt-3 text-sm font-medium">{activeRole.label} lens</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeRole.focus}
          </p>
        </div>
      )}

      <div className="divide-y border-y bg-background">
        {orderedSteps.map((step, index) => (
          <WorkflowCard key={step.label} step={step} number={index + 1} />
        ))}
      </div>

      {showRoleControls && (
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
      )}
    </section>
  )
}
