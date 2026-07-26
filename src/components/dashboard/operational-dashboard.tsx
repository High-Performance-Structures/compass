"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  IconAlertCircle,
  IconArrowRight,
  IconAutomation,
  IconBriefcase,
  IconCalendarWeek,
  IconChevronDown,
  IconChevronRight,
  IconCurrencyDollar,
  IconDatabaseImport,
  IconFiles,
  IconFolder,
  IconLayoutList,
  IconMailForward,
  IconMessageCircle,
  IconMessageCircleQuestion,
  IconPhoto,
  IconRoute,
  IconTargetArrow,
  IconTools,
  IconTrendingUp,
  IconUserHeart,
} from "@tabler/icons-react"

import type { DashboardOverview } from "@/app/actions/dashboard-overview"
import {
  getCherishPulseReviewQueue,
  reviewCherishPulseResponse,
  submitCherishPulseResponse,
  type CherishPulseReviewDecision,
  type CherishPulseResponseType,
  type CherishPulseReviewItem,
  type CherishValue,
} from "@/app/actions/cherish-pulse"
import { useRenderState } from "@/components/agent/chat-provider"
import { RenderedView } from "@/components/agent/rendered-view"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  PROJECT_WORKFLOW_ROLE_LENSES,
  isProjectWorkflowRoleId,
  roleLensForId,
  workflowRoleIdFromString,
  workflowRoleIsAllowed,
  type ProjectWorkflowRoleId,
  type ProjectWorkspaceMode,
} from "@/lib/project-workflow-roles"
import { cn } from "@/lib/utils"
import { dashboardNavigation } from "@/lib/dashboard/navigation"

type DashboardLayoutMode = "list" | "compass"
type SignalTone = "green" | "amber" | "blue" | "red" | "neutral"

type CompassNode = {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly note: string
  readonly href: string
  readonly icon: React.ReactNode
  readonly tone: "project" | "schedule" | "field" | "decision" | "money" | "files" | "talk" | "automation"
}

type PrioritySignal = {
  readonly label: string
  readonly value: string
  readonly note: string
  readonly href: string
  readonly tone: SignalTone
  readonly icon: React.ReactNode
}

type DashboardField = {
  readonly label: string
  readonly value: string
  readonly note: string
  readonly progress: number
  readonly tone: SignalTone
  readonly href: string
  readonly icon: React.ReactNode
}

const DASHBOARD_ROLE_STORAGE_KEY = "compass-dashboard-role-lens"
const DASHBOARD_MODE_STORAGE_KEY = "compass-dashboard-workspace-mode"

const CHERISH_VALUES: readonly CherishValue[] = [
  "Camaraderie",
  "Honor",
  "Excellence",
  "Reliability",
  "Integrity",
  "Servitude",
  "Humility",
] as const

const CHERISH_RESPONSE_COPY: Record<
  CherishPulseResponseType,
  {
    readonly label: string
    readonly prompt: string
    readonly placeholder: string
    readonly visibility: "team" | "private"
  }
> = {
  shoutout: {
    label: "Shoutout",
    prompt: "Who deserves credit this week, and for what?",
    placeholder: "Example: Nolan helped solve the delivery issue before it slowed the crew down.",
    visibility: "team",
  },
  concern: {
    label: "Private concern",
    prompt: "What should leadership know?",
    placeholder: "Share what is getting in the way, what feels unclear, or what needs attention.",
    visibility: "private",
  },
  win: {
    label: "Project win",
    prompt: "What went well on the job?",
    placeholder: "A small win, a client moment, a safety save, or something the team should see.",
    visibility: "team",
  },
}

function storedDashboardRole(
  allowedRoleIds: readonly ProjectWorkflowRoleId[]
): ProjectWorkflowRoleId | null {
  try {
    const roleId = workflowRoleIdFromString(
      window.localStorage.getItem(DASHBOARD_ROLE_STORAGE_KEY)
    )
    return roleId && workflowRoleIsAllowed(roleId, allowedRoleIds)
      ? roleId
      : null
  } catch {
    return null
  }
}

function storedDashboardMode(
  canUseDeveloperMode: boolean
): ProjectWorkspaceMode | null {
  if (!canUseDeveloperMode) return null

  try {
    const value = window.localStorage.getItem(DASHBOARD_MODE_STORAGE_KEY)
    return value === "developer" || value === "worker" ? value : null
  } catch {
    return null
  }
}

function saveDashboardRole(roleId: ProjectWorkflowRoleId): void {
  try {
    window.localStorage.setItem(DASHBOARD_ROLE_STORAGE_KEY, roleId)
  } catch {
    // Local storage is a convenience, not an app dependency.
  }
}

function saveDashboardMode(mode: ProjectWorkspaceMode): void {
  try {
    window.localStorage.setItem(DASHBOARD_MODE_STORAGE_KEY, mode)
  } catch {
    // Local storage is a convenience, not an app dependency.
  }
}

function formatDate(value: string | null): string {
  if (!value) return "No date"
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return "No date"
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function labelize(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function operationHref(projectId: string, type: string): string {
  if (type === "purchase_order") {
    return `/dashboard/projects/${projectId}/purchase-orders`
  }

  return `/dashboard/projects/${projectId}/schedule`
}

function clampPercent(value: number): number {
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function parseDateKey(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatWeekday(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
  }).format(parseDateKey(value))
}

function taskFallsOnDay(
  task: DashboardOverview["upcomingTasks"][number],
  day: string
): boolean {
  return task.startDate <= day && task.endDate >= day
}

function signalClasses(tone: SignalTone): string {
  if (tone === "green") {
    return "border-[#3f7d4d] bg-card text-foreground"
  }
  if (tone === "amber") {
    return "border-[#9d832c] bg-card text-foreground"
  }
  if (tone === "blue") {
    return "border-[#2f5963] bg-card text-foreground"
  }
  if (tone === "red") {
    return "border-[#8a3a2e] bg-card text-foreground"
  }
  return "border-border bg-card text-foreground"
}

function signalHoverClasses(tone: SignalTone): string {
  if (tone === "green") {
    return "hover:border-[#3f7d4d] hover:bg-muted hover:ring-2 hover:ring-[#3f7d4d]/25"
  }
  if (tone === "amber") {
    return "hover:border-[#9d832c] hover:bg-muted hover:ring-2 hover:ring-[#9d832c]/25"
  }
  if (tone === "blue") {
    return "hover:border-[#2f5963] hover:bg-muted hover:ring-2 hover:ring-[#2f5963]/25"
  }
  if (tone === "red") {
    return "hover:border-[#8a3a2e] hover:bg-muted hover:ring-2 hover:ring-[#8a3a2e]/25"
  }
  return "hover:border-primary hover:bg-accent hover:ring-2 hover:ring-primary/25"
}

function signalAccentClasses(tone: SignalTone): string {
  if (tone === "green") return "bg-[#3f7d4d]"
  if (tone === "amber") return "bg-[#9d832c]"
  if (tone === "blue") return "bg-[#2f5963]"
  if (tone === "red") return "bg-[#8a3a2e]"
  return "bg-muted-foreground"
}

function PriorityRailItem({
  signal,
}: {
  readonly signal: PrioritySignal
}) {
  return (
    <Link
      href={signal.href}
      className={cn(
        "group relative block min-w-0 overflow-hidden rounded-lg border p-2 shadow-sm transition-colors duration-200 ease-out",
        "hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        signalClasses(signal.tone),
        signalHoverClasses(signal.tone)
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 z-20 w-1",
          signalAccentClasses(signal.tone)
        )}
      />
      <div className="relative z-10 flex items-center gap-2 pl-1">
        <span className="rounded-md bg-background/70 p-1.5 shadow-sm">
          {signal.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-normal text-current/65">
              {signal.label}
            </p>
            <IconChevronRight className="size-4 shrink-0 opacity-40 transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="truncate text-sm font-semibold leading-tight">
            {signal.value}
          </p>
          <p className="mt-0.5 line-clamp-1 text-xs text-current/70">
            {signal.note}
          </p>
        </div>
      </div>
    </Link>
  )
}

function DashboardFieldCard({
  field,
}: {
  readonly field: DashboardField
}) {
  return (
    <Link
      href={field.href}
      className={cn(
        "group relative block overflow-hidden rounded-lg border p-2.5 shadow-sm transition-colors duration-200 ease-out",
        "hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        signalClasses(field.tone),
        signalHoverClasses(field.tone)
      )}
    >
      <div className="relative z-10 flex items-start justify-between gap-3">
        <span className="rounded-md bg-background/70 p-1.5 shadow-sm">
          {field.icon}
        </span>
        <IconArrowRight className="size-4 opacity-40 transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="relative z-10 mt-2 text-xs font-semibold uppercase tracking-normal text-current/65">
        {field.label}
      </p>
      <p className="relative z-10 mt-0.5 text-lg font-semibold tabular-nums">
        {field.value}
      </p>
      <div className="relative z-10 mt-1.5 h-1 overflow-hidden rounded-full bg-background/70">
        <span
          className={cn("block h-full", signalAccentClasses(field.tone))}
          style={{ width: `${clampPercent(field.progress)}%` }}
        />
      </div>
      <p className="relative z-10 mt-1 line-clamp-1 text-xs text-current/70">
        {field.note}
      </p>
    </Link>
  )
}

function DashboardCommandCenter({
  overview,
}: {
  readonly overview: DashboardOverview
}) {
  const nextTask = overview.upcomingTasks[0]
  const topProject = overview.projects[0]
  const topRfi = overview.openRfis[0]
  const topOperation = overview.operations[0]
  const nextProject = nextTask
    ? overview.projects.find((project) => project.id === nextTask.projectId)
    : null
  const scheduleHref = nextTask
    ? `/dashboard/projects/${nextTask.projectId}/schedule`
    : "/dashboard/schedule"
  const ownerUpdateHref = topProject
    ? `/dashboard/projects/${topProject.id}/daily-logs`
    : "/dashboard/projects/select?target=owner-updates"
  const photosHref = topProject
    ? `/dashboard/projects/${topProject.id}/photos`
    : "/dashboard/projects/select?target=photos"

  const prioritySignals: readonly PrioritySignal[] = [
    {
      label: "Today",
      value: nextTask ? formatDate(nextTask.startDate) : "No task",
      note: nextTask
        ? `${nextTask.projectLabel} · ${nextTask.title}`
        : "No upcoming task",
      href: scheduleHref,
      tone: "blue",
      icon: <IconCalendarWeek className="size-4" />,
    },
    {
      label: "At Risk",
      value:
        overview.metrics.openRfis > 0
          ? `${overview.metrics.openRfis} RFIs`
          : "Clear",
      note: topRfi
        ? `${topRfi.projectLabel} · due ${formatDate(topRfi.dueDate)}`
        : "No open RFIs",
      href: topRfi
        ? `/dashboard/projects/${topRfi.projectId}/rfis`
        : "/dashboard/rfis",
      tone: overview.metrics.openRfis > 0 ? "amber" : "green",
      icon: <IconAlertCircle className="size-4" />,
    },
    {
      label: "Updates",
      value:
        overview.metrics.draftOwnerUpdates > 0
          ? `${overview.metrics.draftOwnerUpdates} drafts`
          : "Ready",
      note: topProject
        ? `${topProject.projectNumber ?? topProject.name} · daily logs`
        : "No project selected",
      href: ownerUpdateHref,
      tone: overview.metrics.draftOwnerUpdates > 0 ? "amber" : "green",
      icon: <IconMailForward className="size-4" />,
    },
    {
      label: "Sage Sync",
      value: overview.sageBridge.configured ? "Connected" : "Needs setup",
      note: overview.sageBridge.configured
        ? `${overview.sageBridge.mappedProjectCount} jobs mapped · ${formatDateTime(overview.sageBridge.lastSyncedAt)}`
        : overview.sageBridge.message,
      href: "/dashboard/automations",
      tone: overview.sageBridge.configured ? "green" : "red",
      icon: <IconDatabaseImport className="size-4" />,
    },
  ]

  const dashboardFields: readonly DashboardField[] = [
    {
      label: "Schedule Load",
      value: String(overview.metrics.upcomingTasks),
      note: nextTask
        ? `${nextTask.projectLabel} is next in queue`
        : "No schedule queue",
      progress: Math.min(100, overview.metrics.upcomingTasks * 12.5),
      tone: "blue",
      href: scheduleHref,
      icon: <IconTrendingUp className="size-4" />,
    },
    {
      label: "Field Review",
      value: String(overview.metrics.photosToReview),
      note:
        overview.metrics.photosToReview > 0
          ? "Photos need visibility decisions"
          : "Photo visibility queue is clear",
      progress: Math.min(100, overview.metrics.photosToReview * 18),
      tone: overview.metrics.photosToReview > 0 ? "amber" : "green",
      href: photosHref,
      icon: <IconPhoto className="size-4" />,
    },
    {
      label: "Open POs",
      value: formatMoney(overview.metrics.openPoAmount),
      note: topOperation
        ? `${topOperation.projectLabel} · ${topOperation.title}`
        : "No open POs",
      progress: Math.min(100, overview.metrics.openPoAmount / 1000),
      tone: "green",
      href: dashboardNavigation.openPurchaseOrders,
      icon: <IconCurrencyDollar className="size-4" />,
    },
  ]

  return (
    <section className="space-y-2">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Start Here</h2>
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
            Priority Rail
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
          {prioritySignals.map((signal) => (
            <PriorityRailItem key={signal.label} signal={signal} />
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        <Card className="overflow-hidden rounded-lg border-primary/20">
          <CardContent className="grid gap-2 p-0 lg:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Next Schedule Item</Badge>
                {nextTask?.assignedTo && (
                  <Badge variant="outline">{nextTask.assignedTo}</Badge>
                )}
              </div>
              <h2 className="mt-2 max-w-3xl text-lg font-semibold tracking-normal">
                {nextTask?.title ?? "No active schedule item"}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {nextTask
                  ? `${nextTask.projectLabel} · ${formatDate(nextTask.startDate)} - ${formatDate(nextTask.endDate)}`
                  : "No schedule item yet."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={scheduleHref}>
                    <IconCalendarWeek className="size-4" />
                    Open Schedule
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={ownerUpdateHref}>
                    <IconMailForward className="size-4" />
                    Owner Update
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={photosHref}>
                    <IconPhoto className="size-4" />
                    Review Photos
                  </Link>
                </Button>
              </div>
            </div>
            <div className="border-t bg-muted/35 p-3 lg:border-l lg:border-t-0">
              <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                Project Pulse
              </p>
              <p className="mt-1 truncate text-sm font-semibold">
                {nextProject?.projectNumber ?? nextTask?.projectLabel ?? "Compass"}
              </p>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium tabular-nums">
                      {nextProject?.progress ?? 0}%
                    </span>
                  </div>
                  <Progress value={nextProject?.progress ?? 0} className="mt-1.5 h-1" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border bg-background p-1.5">
                    <p className="text-xs text-muted-foreground">RFIs</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {nextProject?.openRfiCount ?? overview.metrics.openRfis}
                    </p>
                  </div>
                  <div className="rounded-md border bg-background p-1.5">
                    <p className="text-xs text-muted-foreground">Photos</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {nextProject?.photosToReview ?? overview.metrics.photosToReview}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {dashboardFields.map((field) => (
            <DashboardFieldCard key={field.label} field={field} />
          ))}
        </div>
      </div>
    </section>
  )
}

function DashboardRoleWorkspaceControl({
  overview,
  activeRoleId,
  onActiveRoleChange,
  workspaceMode,
  onWorkspaceModeChange,
}: {
  readonly overview: DashboardOverview
  readonly activeRoleId: ProjectWorkflowRoleId
  readonly onActiveRoleChange: (roleId: ProjectWorkflowRoleId) => void
  readonly workspaceMode: ProjectWorkspaceMode
  readonly onWorkspaceModeChange: (mode: ProjectWorkspaceMode) => void
}): React.ReactElement | null {
  const allowedRoleIds = overview.user.allowedWorkflowRoleIds
  if (allowedRoleIds.length === 0) return null

  const canUseDeveloperMode = overview.user.canUseDeveloperMode
  const activeRole = roleLensForId(activeRoleId)
  const availableRoles = PROJECT_WORKFLOW_ROLE_LENSES.filter((role) =>
    allowedRoleIds.includes(role.id)
  )
  const developerModeEnabled = canUseDeveloperMode && workspaceMode === "developer"

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <IconBriefcase className="size-4 text-emerald-800" />
        <p className="text-sm font-semibold">Role</p>
        <Select
          value={activeRoleId}
          onValueChange={(value) => {
            if (!isProjectWorkflowRoleId(value)) return
            if (!workflowRoleIsAllowed(value, allowedRoleIds)) return
            onActiveRoleChange(value)
          }}
        >
          <SelectTrigger
            size="sm"
            className="h-8 w-[220px] bg-background"
            aria-label="Select role dashboard"
          >
            <SelectValue placeholder={activeRole.label} />
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
          {canUseDeveloperMode ? "Admin" : "Role based"}
        </span>
      </div>

      {canUseDeveloperMode && (
        <div className="flex items-center gap-2">
          <IconTools className="size-4 text-muted-foreground" />
          <p className="text-xs font-medium">
            {developerModeEnabled ? "Developer" : "Work"}
          </p>
          <Switch
            checked={developerModeEnabled}
            onCheckedChange={(checked) =>
              onWorkspaceModeChange(checked ? "developer" : "worker")
            }
            aria-label="Toggle dashboard developer mode"
          />
        </div>
      )}
    </div>
  )
}

function ProjectPulse({
  overview,
}: {
  readonly overview: DashboardOverview
}): React.ReactElement {
  return (
    <Card className="overflow-hidden rounded-lg">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Project Pulse</CardTitle>
            <CardDescription>
              Field photos and team notes
            </CardDescription>
          </div>
          <Badge variant="secondary">This week</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-0 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <FieldPulse photos={overview.fieldPhotos} />
          <DashboardCommandCenter overview={overview} />
        </div>
        <CherishPulse />
      </CardContent>
    </Card>
  )
}

function FieldPulse({
  photos,
}: {
  readonly photos: DashboardOverview["fieldPhotos"]
}): React.ReactElement {
  const [activeIndex, setActiveIndex] = useState(0)
  const [failedPhotoIds, setFailedPhotoIds] = useState<readonly string[]>([])

  useEffect(() => {
    if (photos.length < 2) return

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % photos.length)
    }, 7000)

    return () => window.clearInterval(timer)
  }, [photos.length])

  if (photos.length === 0) {
    return (
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <div className="flex aspect-[4/3] items-center justify-center rounded-lg border bg-muted/40">
          <IconPhoto className="size-10 text-muted-foreground" />
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <div className="flex items-center gap-2">
            <span className="rounded-md border bg-background p-1.5 text-muted-foreground">
              <IconPhoto className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">Field Pulse</p>
              <p className="text-xs text-muted-foreground">
                Approved photos
              </p>
            </div>
          </div>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            No approved photos yet.
          </p>
        </div>
      </div>
    )
  }

  const activePhoto = photos[activeIndex] ?? photos[0]
  if (!activePhoto) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-lg border bg-muted/40">
        <IconPhoto className="size-10 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted">
        {photos.map((photo, index) => {
          const imageFailed = failedPhotoIds.includes(photo.id)

          return (
            <div
              key={photo.id}
              className={cn(
                "absolute inset-0 transition-opacity duration-1000 ease-in-out",
                index === activeIndex ? "opacity-100" : "opacity-0"
              )}
              aria-hidden={index !== activeIndex}
            >
              {!imageFailed ? (
                <>
                  <Image
                    src={photo.imageUrl}
                    alt=""
                    fill
                    sizes="(min-width: 1280px) 384px, (min-width: 1024px) 384px, 100vw"
                    unoptimized
                    className="scale-105 object-cover opacity-20 blur-md"
                    aria-hidden="true"
                  />
                  <Image
                    src={photo.imageUrl}
                    alt={photo.caption ?? photo.fileName}
                    fill
                    sizes="(min-width: 1280px) 384px, (min-width: 1024px) 384px, 100vw"
                    unoptimized
                    className="object-contain"
                    onError={() =>
                      setFailedPhotoIds((current) =>
                        current.includes(photo.id)
                          ? current
                          : [...current, photo.id]
                      )
                    }
                  />
                </>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <IconPhoto className="size-10 text-muted-foreground" />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex min-w-0 flex-col justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border bg-background p-1.5 text-muted-foreground">
              <IconPhoto className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">Field Pulse</p>
              <p className="text-xs text-muted-foreground">
                Approved photos
              </p>
            </div>
          </div>
          <h2 className="mt-3 line-clamp-2 text-lg font-semibold">
            {activePhoto.caption ?? activePhoto.fileName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {activePhoto.projectLabel} · {formatDate(activePhoto.capturedAt)}
          </p>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
            {activePhoto.projectName}
          </p>
        </div>

        <div className="grid gap-2">
          <div className="grid grid-cols-10 gap-1.5">
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                aria-label={`Show field photo ${index + 1}`}
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "h-1.5 rounded-full bg-muted transition-colors",
                  index === activeIndex && "bg-primary"
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function CherishPulse(): React.ReactElement {
  const [responseType, setResponseType] =
    useState<CherishPulseResponseType>("shoutout")
  const [responseText, setResponseText] = useState("")
  const [responses, setResponses] = useState<readonly CherishPulseReviewItem[]>([])
  const [responseDoorsOpen, setResponseDoorsOpen] = useState(false)
  const [reviewQueueAvailable, setReviewQueueAvailable] = useState(true)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const activeCopy = CHERISH_RESPONSE_COPY[responseType]

  useEffect(() => {
    let componentIsMounted = true

    async function loadReviewQueue(): Promise<void> {
      const result = await getCherishPulseReviewQueue()
      if (!componentIsMounted) return

      if (result.success) {
        setResponses(result.data)
        setReviewQueueAvailable(true)
      } else {
        setReviewQueueAvailable(false)
      }
    }

    void loadReviewQueue()

    return () => {
      componentIsMounted = false
    }
  }, [])

  function handleStageResponse(): void {
    const trimmedText = responseText.trim()
    if (trimmedText.length === 0) return

    startTransition(async () => {
      setSubmitMessage(null)
      const result = await submitCherishPulseResponse({
        cherishValue: "Reliability",
        responseType,
        message: trimmedText,
        source: "compass_dashboard",
      })

      if (!result.success) {
        setSubmitMessage(result.error)
        return
      }

      setResponses((current) => [result.data, ...current])
      setResponseText("")
      setSubmitMessage(
        activeCopy.visibility === "private"
          ? "Saved privately for leadership review."
          : "Saved to the review queue."
      )
    })
  }

  function handleResponseTypeChange(value: string): void {
    if (value === "shoutout" || value === "concern" || value === "win") {
      setResponseType(value)
    }
  }

  function handleReviewResponse(
    id: string,
    decision: CherishPulseReviewDecision
  ): void {
    setReviewMessage(null)
    setReviewingId(id)

    async function reviewResponse(): Promise<void> {
      const result = await reviewCherishPulseResponse({ id, decision })
      if (!result.success) {
        setReviewMessage(result.error)
        setReviewingId(null)
        return
      }

      setResponses((current) =>
        current.filter((response) => response.id !== result.data.id)
      )
      setReviewMessage(
        result.data.reviewStatus === "approved"
          ? "Approved for the team-visible CHERISH stream."
          : "Archived from the review queue."
      )
      setReviewingId(null)
    }

    void reviewResponse()
  }

  return (
    <div className="min-w-0 rounded-lg border bg-background p-3">
      <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border bg-background p-1.5 text-emerald-800">
              <IconUserHeart className="size-4" />
            </span>
            <p className="text-sm font-semibold">Thursday Pulse</p>
            <Badge variant="secondary">CHERISH</Badge>
            <Badge variant="outline">Field friendly</Badge>
          </div>

          <div className="mt-3 rounded-md border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                This week
              </p>
              <Badge className="bg-emerald-700">Reliability</Badge>
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">
              Who helped keep something moving?
            </h2>
            <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
              Share a shoutout, project win, or private concern.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {CHERISH_VALUES.map((value) => (
                <span
                  key={value}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    value === "Reliability"
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "bg-muted/40 text-muted-foreground"
                  )}
                >
                  {value}
                </span>
              ))}
            </div>
          </div>

        <div className="mt-3 border-t pt-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Respond</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Keep it quick.
              </p>
            </div>
            <Badge variant={activeCopy.visibility === "private" ? "secondary" : "outline"}>
              {activeCopy.visibility === "private" ? "Private" : "Team"}
            </Badge>
          </div>

          <div className="mt-3 grid gap-2">
            <Select value={responseType} onValueChange={handleResponseTypeChange}>
              <SelectTrigger className="h-9">
                <SelectValue aria-label={activeCopy.label} />
              </SelectTrigger>
              <SelectContent>
                {(["shoutout", "concern", "win"] as const).map((type) => (
                  <SelectItem key={type} value={type}>
                    {CHERISH_RESPONSE_COPY[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {activeCopy.prompt}
            </p>
            <Textarea
              value={responseText}
              onChange={(event) => setResponseText(event.target.value)}
              placeholder={activeCopy.placeholder}
              className="min-h-16 resize-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {activeCopy.visibility === "private" ? "Private to leadership." : "Visible after review."}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={handleStageResponse}
                disabled={responseText.trim().length === 0 || isPending}
              >
                {isPending ? "Saving..." : "Stage response"}
              </Button>
            </div>
            {submitMessage && (
              <p
                className={cn(
                  "mt-2 text-xs",
                  submitMessage.startsWith("Saved")
                    ? "text-emerald-700"
                    : "text-destructive"
                )}
              >
                {submitMessage}
              </p>
            )}
          </div>

          <Collapsible
            open={responseDoorsOpen}
            onOpenChange={setResponseDoorsOpen}
            className="mt-3 rounded-md border bg-muted/20"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left"
              >
                <span>
                  <span className="block text-xs font-semibold">
                    Other ways to respond
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Field and office options.
                  </span>
                </span>
                <IconChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    responseDoorsOpen && "rotate-180"
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-2 border-t p-2.5">
                {[
                  ["Compass app", "Big mobile buttons for crew and office."],
                  ["Telegram", "Reply to the weekly prompt in the field."],
                  ["ExakTime", "Review time-clock comments."],
                  ["Admin entry", "Log a phone call or text on someone’s behalf."],
                ].map(([label, detail]) => (
                  <div key={label} className="rounded-md border bg-background p-2">
                    <p className="text-xs font-semibold">{label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="mt-3 border-t pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">
                {reviewQueueAvailable ? "Review queue" : "Leadership review"}
              </p>
              <Badge variant="secondary">
                {reviewQueueAvailable ? responses.length : "Secure"}
              </Badge>
            </div>
            <div className="mt-2 space-y-2">
              {!reviewQueueAvailable && (
                <div className="rounded-md border bg-muted/20 p-2.5">
                  <p className="text-xs text-muted-foreground">
                    Responses are stored in Compass. Private concerns stay with
                    admins and are handled through the review controls.
                  </p>
                </div>
              )}
              {reviewQueueAvailable && responses.length === 0 && (
                <div className="rounded-md border bg-muted/20 p-2.5">
                  <p className="text-xs text-muted-foreground">
                    Nothing is waiting for review yet.
                  </p>
                </div>
              )}
              {reviewQueueAvailable && responses.slice(0, 2).map((response) => (
                <div
                  key={response.id}
                  className={cn(
                    "rounded-md border p-2.5",
                    response.visibility === "private" && "border-[#9d832c] bg-card"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={response.visibility === "private" ? "secondary" : "outline"}>
                      {CHERISH_RESPONSE_COPY[response.responseType].label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {sourceLabel(response.source)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {response.message}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {response.submittedByName ?? "Team member"} · {formatShortDate(response.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleReviewResponse(response.id, "approve")}
                      disabled={reviewingId === response.id}
                    >
                      {reviewingId === response.id ? "Working..." : "Approve"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleReviewResponse(response.id, "archive")}
                      disabled={reviewingId === response.id}
                    >
                      Archive
                    </Button>
                  </div>
                </div>
              ))}
              {reviewMessage && (
                <p
                  className={cn(
                    "text-xs",
                    reviewMessage.startsWith("Approved") ||
                      reviewMessage.startsWith("Archived")
                      ? "text-emerald-700"
                      : "text-destructive"
                  )}
                >
                  {reviewMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function sourceLabel(source: CherishPulseReviewItem["source"]): string {
  switch (source) {
    case "compass_mobile":
      return "Compass app"
    case "telegram":
      return "Telegram"
    case "exaktime":
      return "ExakTime"
    case "admin_entry":
      return "Admin entry"
    default:
      return "Compass dashboard"
  }
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not synced yet"
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function CompassNodeCard({
  node,
  align = "center",
  className,
  style,
}: {
  readonly node: CompassNode
  readonly align?: "left" | "center" | "right"
  readonly className?: string
  readonly style?: React.CSSProperties
}) {
  const card = (
    <Link
      href={node.href}
      className={cn(
        "group relative z-0 block overflow-hidden rounded-lg border bg-background/95 p-3 shadow-sm transition-all duration-200 ease-out",
        "after:absolute after:inset-0 after:bg-muted/70 after:opacity-0 after:transition-opacity after:duration-200 after:content-['']",
        "hover:z-[100] hover:-translate-y-5 hover:scale-[1.07] hover:border-primary hover:shadow-2xl hover:after:opacity-100",
        "focus-visible:z-[100] focus-visible:-translate-y-5 focus-visible:scale-[1.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:after:opacity-100",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right"
      )}
    >
      <div
        className={cn(
          "relative z-10 flex items-start gap-3",
          align === "right" ? "justify-start" : "justify-between",
          align === "center" && "justify-center"
        )}
      >
        {align === "right" && (
          <IconChevronRight className="mt-1 size-4 shrink-0 rotate-180 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        )}
        <span
          className={cn(
            "rounded-md border bg-card p-2 text-muted-foreground transition-colors group-hover:text-foreground",
            node.tone === "project" && "border-[#6f471f] text-[#6f471f]",
            node.tone === "schedule" && "border-[#2f5963] text-[#2f5963]",
            node.tone === "field" && "border-[#9d832c] text-[#715d1c]",
            node.tone === "decision" && "border-[#8a3a2e] text-[#8a3a2e]",
            node.tone === "money" && "border-[#3f7d4d] text-[#3f7d4d]",
            node.tone === "files" && "border-[#585149] text-[#585149]",
            node.tone === "talk" && "border-[#2f5963] text-[#2f5963]",
            node.tone === "automation" && "border-[#6f471f] text-[#6f471f]"
          )}
        >
          {node.icon}
        </span>
        {align !== "right" && (
          <IconChevronRight
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100",
              align === "center" && "hidden"
            )}
          />
        )}
      </div>
      <div className="relative z-10 mt-3">
        <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
          {node.label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {node.value}
        </p>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {node.note}
        </p>
      </div>
    </Link>
  )

  if (style || className) {
    return (
      <div
        style={style}
        className={cn(
          "z-0 transition-[z-index] hover:z-[100] focus-within:z-[100]",
          className
        )}
      >
        {card}
      </div>
    )
  }

  return card
}

function CompassDashboard({
  overview,
}: {
  readonly overview: DashboardOverview
}) {
  const nodes = useMemo<CompassNode[]>(() => {
    const nextTask = overview.upcomingTasks[0]
    const topProject = overview.projects[0]
    const topRfi = overview.openRfis[0]
    const topOperation = overview.operations[0]

    return [
      {
        key: "projects",
        label: "Projects",
        value: String(overview.metrics.activeProjects),
        note: topProject
          ? `${topProject.projectNumber ?? topProject.name} · ${topProject.progress}%`
          : "No mapped projects yet",
        href: "/dashboard/projects",
        icon: <IconFolder className="size-4" />,
        tone: "project",
      },
      {
        key: "schedule",
        label: "Schedule",
        value: String(overview.metrics.upcomingTasks),
        note: nextTask
          ? `${formatDate(nextTask.startDate)} · ${nextTask.title}`
          : "No upcoming tasks found",
        href: nextTask
          ? `/dashboard/projects/${nextTask.projectId}/schedule`
          : "/dashboard/schedule",
        icon: <IconCalendarWeek className="size-4" />,
        tone: "schedule",
      },
      {
        key: "field",
        label: "Field Review",
        value: String(overview.metrics.photosToReview),
        note:
          overview.metrics.photosToReview > 0
            ? "Photos waiting on visibility review"
            : "No photos waiting on review",
        href: topProject
          ? `/dashboard/projects/${topProject.id}/photos`
          : "/dashboard/projects/select?target=photos",
        icon: <IconPhoto className="size-4" />,
        tone: "field",
      },
      {
        key: "rfis",
        label: "Decisions",
        value: String(overview.metrics.openRfis),
        note: topRfi
          ? `${topRfi.rfiNumber} · ${topRfi.subject}`
          : "No open RFIs",
        href: topRfi
          ? `/dashboard/projects/${topRfi.projectId}/rfis`
          : "/dashboard/rfis",
        icon: <IconMessageCircleQuestion className="size-4" />,
        tone: "decision",
      },
      {
        key: "financials",
        label: "Financials",
        value: formatMoney(overview.metrics.openPoAmount),
        note: topOperation
          ? `${topOperation.projectLabel} · ${topOperation.title}`
          : "No open Sage operation records",
        href: topOperation
          ? operationHref(topOperation.projectId, topOperation.type)
          : "/dashboard/purchase-orders",
        icon: <IconCurrencyDollar className="size-4" />,
        tone: "money",
      },
      {
        key: "files",
        label: "Files",
        value: String(
          overview.projects.filter((project) => project.googleDriveFolderId)
            .length
        ),
        note: "Mapped project folders in Google Drive",
        href: "/dashboard/files",
        icon: <IconFiles className="size-4" />,
        tone: "files",
      },
      {
        key: "conversations",
        label: "Conversations",
        value: "Open",
        note: "Project channels, pinned notes, and follow-ups",
        href: "/dashboard/conversations",
        icon: <IconMessageCircle className="size-4" />,
        tone: "talk",
      },
      {
        key: "automations",
        label: "Automations",
        value: overview.sageBridge.configured ? "Ready" : "Needs setup",
        note: "Scripts, Sage bridge, and handoffs",
        href: "/dashboard/automations",
        icon: <IconAutomation className="size-4" />,
        tone: "automation",
      },
    ]
  }, [overview])

  return (
    <div className="space-y-4">
      <section className="relative hidden min-h-[620px] overflow-hidden rounded-lg border bg-background p-5 xl:block">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[29rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full border" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[19rem] w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[45rem] -translate-x-1/2 bg-border/70" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[29rem] w-px -translate-y-1/2 bg-border/70" />

        <div className="absolute left-1/2 top-1/2 flex size-56 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border bg-card p-6 text-center shadow-sm">
          <IconTargetArrow className="pointer-events-none absolute size-40 text-muted-foreground/[0.06]" stroke={1.25} />
          <span className="rounded-full border bg-background p-3 text-primary">
            <IconTargetArrow className="size-7" />
          </span>
          <h2 className="mt-3 text-xl font-semibold">Compass</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Today at HPS
          </p>
          <Badge
            className="mt-3"
            variant={overview.sageBridge.configured ? "secondary" : "outline"}
          >
            {overview.sageBridge.configured
              ? overview.sageBridge.readOnly
                ? "Sage read-only"
                : "Sage write-gated"
              : "Sage needs secrets"}
          </Badge>
        </div>

        {nodes.map((node, index) => {
          const angle = -90 + index * (360 / nodes.length)
          const radiusX = 245
          const radiusY = 230
          const x = Math.cos((angle * Math.PI) / 180) * radiusX
          const y = Math.sin((angle * Math.PI) / 180) * radiusY
          const align =
            x < -70 ? "right" : x > 70 ? "left" : "center"
          const transform =
            x < -80
              ? "translate(-100%, -50%)"
              : x > 80
                ? "translate(0, -50%)"
                : "translate(-50%, -50%)"

          return (
            <CompassNodeCard
              key={node.key}
              node={node}
              align={align}
              className="absolute w-48"
              style={{
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                transform,
              }}
            />
          )
        })}
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:hidden">
        <Card className="rounded-lg sm:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <IconRoute className="size-5 text-muted-foreground" />
              <CardTitle>Compass View</CardTitle>
            </div>
            <CardDescription>
              Operational map
            </CardDescription>
          </CardHeader>
        </Card>
        {nodes.map((node) => (
          <CompassNodeCard key={node.key} node={node} />
        ))}
      </section>
    </div>
  )
}

export function OperationalDashboard({
  overview,
}: {
  readonly overview: DashboardOverview
}) {
  const { spec, isRendering } = useRenderState()
  const [layoutMode, setLayoutMode] =
    useState<DashboardLayoutMode>("list")
  const [activeRoleId, setActiveRoleId] = useState<ProjectWorkflowRoleId>(
    overview.user.defaultWorkflowRoleId
  )
  const [workspaceMode, setWorkspaceMode] =
    useState<ProjectWorkspaceMode>("worker")
  const hasRenderedUI = !!spec?.root || isRendering
  const allowedRoleIds = overview.user.allowedWorkflowRoleIds

  useEffect(() => {
    const savedRole = storedDashboardRole(allowedRoleIds)
    if (savedRole) {
      setActiveRoleId(savedRole)
      return
    }

    if (!workflowRoleIsAllowed(activeRoleId, allowedRoleIds)) {
      setActiveRoleId(overview.user.defaultWorkflowRoleId)
    }
  }, [activeRoleId, allowedRoleIds, overview.user.defaultWorkflowRoleId])

  useEffect(() => {
    const savedMode = storedDashboardMode(overview.user.canUseDeveloperMode)
    if (savedMode) setWorkspaceMode(savedMode)
  }, [overview.user.canUseDeveloperMode])

  function handleDashboardRoleChange(roleId: ProjectWorkflowRoleId): void {
    if (!workflowRoleIsAllowed(roleId, allowedRoleIds)) return

    setActiveRoleId(roleId)
    saveDashboardRole(roleId)
  }

  function handleDashboardModeChange(mode: ProjectWorkspaceMode): void {
    if (!overview.user.canUseDeveloperMode && mode === "developer") return

    setWorkspaceMode(mode)
    saveDashboardMode(mode)
  }

  const developerModeEnabled =
    overview.user.canUseDeveloperMode && workspaceMode === "developer"

  const attentionProjects = useMemo(
    () =>
      overview.projects
        .map((project) => ({
          project,
          score:
            project.openRfiCount * 5 +
            project.photosToReview * 4 +
            project.openPoCount * 2 +
            (project.nextTask ? 1 : 0),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score
          return (left.project.projectNumber ?? left.project.name).localeCompare(
            right.project.projectNumber ?? right.project.name
          )
        })
        .slice(0, 6),
    [overview.projects]
  )
  const calendarDays = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) =>
        toDateKey(addDays(parseDateKey(overview.today), index))
      ),
    [overview.today]
  )

  if (hasRenderedUI) {
    return <RenderedView />
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-3 sm:p-4 lg:p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-normal">
              Dashboard
            </h1>
            <Badge variant="outline">HPS operations</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToggleGroup
            type="single"
            value={layoutMode}
            onValueChange={(value) => {
              if (value === "list" || value === "compass") {
                setLayoutMode(value)
              }
            }}
            variant="outline"
            size="sm"
            className="h-9"
          >
            <ToggleGroupItem value="list" aria-label="List dashboard">
              <IconLayoutList className="size-4" />
              List
            </ToggleGroupItem>
            <ToggleGroupItem value="compass" aria-label="Compass dashboard">
              <IconTargetArrow className="size-4" />
              Compass
            </ToggleGroupItem>
          </ToggleGroup>
          <Button asChild size="sm">
            <Link href="/dashboard/projects">
              <IconFolder className="size-4" />
              Projects
            </Link>
          </Button>
        </div>
      </div>

      <DashboardRoleWorkspaceControl
        overview={overview}
        activeRoleId={activeRoleId}
        onActiveRoleChange={handleDashboardRoleChange}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={handleDashboardModeChange}
      />

      {layoutMode === "compass" && <CompassDashboard overview={overview} />}

      {layoutMode === "list" && (
        <>
      <ProjectPulse overview={overview} />

      <div className="grid grid-cols-1 gap-4">
        <Card className="rounded-lg">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Work Calendar</CardTitle>
                <CardDescription>
                  A two-week glance at the next project commitments.
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/schedule">
                  Full calendar
                  <IconArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(overview.openRfis.length > 0 || overview.operations.length > 0) && (
              <div className="grid gap-2 rounded-md border border-[#9d832c] bg-card px-3 py-2 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <IconAlertCircle className="size-4 shrink-0 text-[#715d1c]" />
                  <span className="truncate">Critical Attention</span>
                  <Badge variant="outline">
                    {overview.openRfis.length + overview.operations.length}
                  </Badge>
                </div>

                <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  {overview.openRfis.slice(0, 1).map((rfi) => (
                    <Link
                      key={rfi.id}
                      href={`/dashboard/projects/${rfi.projectId}/rfis`}
                      className="flex min-w-0 items-center rounded-md border bg-background/80 px-2.5 py-1.5 text-xs transition-colors hover:bg-background"
                    >
                      <span className="shrink-0 font-medium">RFI</span>
                      <span className="mx-1 shrink-0 text-muted-foreground">·</span>
                      <span className="min-w-0 truncate">{rfi.subject}</span>
                    </Link>
                  ))}
                  {overview.operations.slice(0, 1).map((operation) => (
                    <Link
                      key={operation.id}
                      href={operationHref(operation.projectId, operation.type)}
                      className="flex min-w-0 items-center rounded-md border bg-background/80 px-2.5 py-1.5 text-xs transition-colors hover:bg-background"
                    >
                      <span className="shrink-0 font-medium">
                        {labelize(operation.type)}
                      </span>
                      <span className="mx-1 shrink-0 text-muted-foreground">·</span>
                      <span className="min-w-0 truncate">{operation.title}</span>
                    </Link>
                  ))}
                  {overview.openRfis.length + overview.operations.length > 2 && (
                    <Link
                      href="/dashboard/schedule"
                      className="flex shrink-0 items-center justify-center rounded-md border bg-background/70 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-background"
                    >
                      +
                      {overview.openRfis.length + overview.operations.length - 2}
                    </Link>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-2 md:grid-cols-7">
              {calendarDays.map((day) => {
                const dayTasks = overview.upcomingTasks.filter((task) =>
                  taskFallsOnDay(task, day)
                )

                return (
                  <div
                    key={day}
                    className="min-h-32 rounded-lg border bg-background p-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold">
                          {formatWeekday(day)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(day)}
                        </p>
                      </div>
                      <Badge variant="outline">{dayTasks.length}</Badge>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {dayTasks.slice(0, 2).map((task) => (
                        <Link
                          key={`${day}-${task.id}`}
                          href={`/dashboard/projects/${task.projectId}/schedule`}
                          className="block rounded-md border border-[#2f5963] bg-card p-2 text-xs transition-colors hover:bg-muted"
                        >
                          <span className="line-clamp-2 font-medium">
                            {task.title}
                          </span>
                          <span className="mt-1 block truncate text-muted-foreground">
                            {task.projectLabel}
                          </span>
                        </Link>
                      ))}
                      {dayTasks.length > 2 && (
                        <p className="px-1 text-xs text-muted-foreground">
                          +{dayTasks.length - 2} more
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {attentionProjects.length > 0 && (
              <div className="grid gap-2 md:grid-cols-2">
                {attentionProjects.slice(0, 4).map(({ project }) => (
                  <Link
                    key={project.id}
                    href={`/dashboard/projects/${project.id}`}
                    className="rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {project.projectNumber ?? project.name}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {project.name}
                        </p>
                      </div>
                      <IconArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {project.openRfiCount > 0 && (
                        <Badge variant="secondary">
                          {project.openRfiCount} RFIs
                        </Badge>
                      )}
                      {project.photosToReview > 0 && (
                        <Badge variant="outline">
                          {project.photosToReview} photos
                        </Badge>
                      )}
                      {project.openPoCount > 0 && (
                        <Badge variant="outline">{project.openPoCount} POs</Badge>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {developerModeEnabled && (
        <Card className="rounded-lg">
          <CardContent className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-md border bg-background p-1.5 text-muted-foreground">
                <IconDatabaseImport className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium">Sage API bridge</h2>
                  <Badge
                    variant={
                      overview.sageBridge.configured ? "secondary" : "outline"
                    }
                  >
                    {overview.sageBridge.configured
                      ? overview.sageBridge.readOnly
                        ? "Read-only"
                        : "Write-gated"
                      : "Needs secrets"}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {overview.sageBridge.message}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Mapped projects</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {overview.sageBridge.mappedProjectCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sage records</p>
              <p className="mt-0.5 text-sm font-medium tabular-nums">
                {overview.sageBridge.mappedOperationCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last sync</p>
              <p className="mt-0.5 text-sm font-medium">
                {formatDateTime(overview.sageBridge.lastSyncedAt)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
        </>
      )}
    </div>
  )
}
