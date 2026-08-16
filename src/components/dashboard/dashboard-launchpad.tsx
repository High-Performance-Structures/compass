"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import Image from "next/image"
import Link from "next/link"
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBuilding,
  IconBuildingSkyscraper,
  IconCalendarWeek,
  IconCheck,
  IconChecklist,
  IconClipboardText,
  IconFileInvoice,
  IconHeartHandshake,
  IconHome2,
  IconMapPin,
  IconMessageCircleQuestion,
  IconPhoto,
  IconPhotoEdit,
  IconPlus,
  IconReceipt,
  IconSparkles,
  IconUserHeart,
  IconUsers,
} from "@tabler/icons-react"

import type { DashboardOverview } from "@/app/actions/dashboard-overview"
import { updateWorkspacePhoto } from "@/app/actions/profile"
import {
  submitCherishPulseResponse,
  type CherishPulseResponseType,
} from "@/app/actions/cherish-pulse"
import {
  getOrganizationTeamAvailability,
  updatePresence,
} from "@/app/actions/presence"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { OfficeMaintenanceDrawer } from "@/components/projects/office-maintenance-drawer"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { SidebarUser } from "@/lib/auth"
import {
  DESK_STATUS_LABELS,
  deskStatusForPresenceMessage,
  isDeskStatus,
  type DeskStatus,
  type TeamAvailabilityMember,
} from "@/lib/dashboard/office-status"
import { dashboardDeskPhotoStorageKey } from "@/lib/user-photo-storage"
import {
  canManageWorkspacePhoto,
  resolveWorkspacePhoto,
  WORKSPACE_PHOTO_REMOVED,
} from "@/lib/workspace-photo-policy"
import { isProjectTodoRecordType } from "@/lib/project-todos"
import {
  compareOfficeCalendarPriority,
  projectPurchaseOrderHref,
  projectTodoHref,
  scheduleItemHref,
} from "@/lib/work-calendar"
import { cn } from "@/lib/utils"
import { usePresence } from "@/contexts/presence-context"

type DashboardMode = "office" | "project"

type LaunchpadTask = {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly href: string
  readonly category:
    | "Event"
    | "Invoice"
    | "Owner update"
    | "Field review"
}

export type DashboardOfficeEvent = {
  readonly id: string
  readonly projectId: string | null
  readonly projectLabel: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly href: string
  readonly allDay: boolean
  readonly startTime: string
}

const TEAM_AVAILABILITY_REFRESH_MS = 10_000

function canManageDeskPhoto(user: SidebarUser | null): boolean {
  return (
    user !== null &&
    canManageWorkspacePhoto({
      actor: {
        userId: user.id,
        organizationId: user.organizationId,
        organizationType: user.organizationType,
        role: user.role,
        isActive: user.isActive,
        isDemo: user.isDemo,
      },
      photo: {
        userId: user.id,
        organizationId: user.organizationId ?? "",
      },
    })
  )
}

function deskPhotoScopeForUser(user: SidebarUser | null): string | null {
  return user !== null && canManageDeskPhoto(user) && user.organizationId
    ? `${user.organizationId}:${user.id}`
    : null
}

function deskPhotoForUser(user: SidebarUser | null): string | null {
  if (!user || !canManageDeskPhoto(user)) return null
  if (!user.organizationId) return null
  const durablePhoto = user.dashboardDeskPhoto
  let cachedPhoto: string | null = null

  if (user.organizationId) {
    try {
      const scope = { organizationId: user.organizationId, userId: user.id }
      const storedPhoto = window.localStorage.getItem(
        dashboardDeskPhotoStorageKey(scope)
      )
      cachedPhoto = storedPhoto
    } catch {
      cachedPhoto = null
    }
  }

  return resolveWorkspacePhoto({
    durablePhoto,
    cachedPhoto,
    allowCache: true,
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }
      reject(new Error("Could not read this image."))
    }
    reader.onerror = () => reject(new Error("Could not read this image."))
    reader.readAsDataURL(file)
  })
}

function resizeDeskPhoto(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () => {
      const scale = Math.min(
        1,
        900 / image.naturalWidth,
        700 / image.naturalHeight
      )
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) {
        resolve(dataUrl)
        return
      }
      context.drawImage(image, 0, 0, width, height)
      resolve(canvas.toDataURL("image/jpeg", 0.86))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

function saveDeskPhoto(user: SidebarUser, dataUrl: string): void {
  if (!canManageDeskPhoto(user) || !user.organizationId) return
  try {
    window.localStorage.setItem(
      dashboardDeskPhotoStorageKey({
        organizationId: user.organizationId,
        userId: user.id,
      }),
      dataUrl
    )
  } catch {
    // The updated image still remains available for the current session.
  }
}

function resetDeskPhoto(user: SidebarUser): void {
  if (!canManageDeskPhoto(user) || !user.organizationId) return
  try {
    const scope = { organizationId: user.organizationId, userId: user.id }
    window.localStorage.removeItem(dashboardDeskPhotoStorageKey(scope))
  } catch {
    // The durable profile reset still applies when browser storage is unavailable.
  }
}

function presenceStatusForDeskStatus(
  status: DeskStatus
): "online" | "offline" {
  return status === "out" ? "offline" : "online"
}

function deskStatusDotClass(status: DeskStatus): string {
  if (status === "out") return "bg-muted-foreground"
  if (status === "on-site") return "bg-amber-500"
  if (status === "remote") return "bg-sky-600"
  return "bg-emerald-600"
}

function includeCurrentAvailability(
  members: readonly TeamAvailabilityMember[],
  user: SidebarUser | null,
  status: DeskStatus,
  activity: "active" | "idle"
): readonly TeamAvailabilityMember[] {
  if (!user) return members

  const existing = members.find((member) => member.userId === user.id)
  const currentMember: TeamAvailabilityMember = {
    userId: user.id,
    name: user.name,
    avatarUrl: user.avatar,
    status,
    activity,
    lastActiveAt:
      activity === "active"
        ? new Date().toISOString()
        : existing?.lastActiveAt ?? null,
    updatedAt: existing?.updatedAt ?? new Date().toISOString(),
    isCurrentUser: true,
  }

  return [
    currentMember,
    ...members
      .filter((member) => member.userId !== user.id)
      .map((member) => ({ ...member, isCurrentUser: false })),
  ]
}

function parseDateKey(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" })
    .format(parseDateKey(value))
    .toUpperCase()
}

function formatMonthDay(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parseDateKey(value))
}

function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(parseDateKey(value))
}

function taskFallsOnDay(
  task: {
    readonly startDate: string
    readonly endDate: string
  },
  day: string
): boolean {
  return task.startDate <= day && task.endDate >= day
}

function belongsToOfficeProject(projectLabel: string): boolean {
  const normalized = projectLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
  return normalized === "h-office" || normalized.startsWith("h-office-")
}

function compareOfficePriority(
  left: { readonly projectLabel: string },
  right: { readonly projectLabel: string }
): number {
  const leftIsOffice = belongsToOfficeProject(left.projectLabel)
  const rightIsOffice = belongsToOfficeProject(right.projectLabel)
  if (leftIsOffice === rightIsOffice) return 0
  return leftIsOffice ? -1 : 1
}

function greetingForNow(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

function Horizon({
  overview,
  mode,
  officeCalendarEvents,
  officeProjectId,
}: {
  readonly overview: DashboardOverview
  readonly mode: DashboardMode
  readonly officeCalendarEvents: readonly DashboardOfficeEvent[]
  readonly officeProjectId: string | null
}): React.ReactElement {
  const days = useMemo(
    () =>
      Array.from({ length: 5 }, (_, index) =>
        dateKey(addDays(parseDateKey(overview.today), index))
      ),
    [overview.today]
  )
  const horizonEntries = useMemo(
    () =>
      mode === "office"
        ? officeCalendarEvents
            .slice()
            .sort((left, right) =>
              compareOfficeCalendarPriority(
                left,
                right,
                officeProjectId
              )
            )
        : overview.upcomingTasks.map((task) => ({
            id: task.id,
            projectId: task.projectId,
            projectLabel: task.projectLabel,
            title: task.title,
            startDate: task.startDate,
            endDate: task.endDate,
            href: scheduleItemHref(task.projectId, task.id),
            allDay: true,
            startTime: "",
          })),
    [mode, officeCalendarEvents, officeProjectId, overview.upcomingTasks]
  )

  return (
    <section className="min-w-0 border-y border-border/70 bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconCalendarWeek className="size-4 shrink-0 text-[#2f5963]" />
          <div>
            <h2 className="text-sm font-semibold">Five-day horizon</h2>
            <p className="text-xs text-muted-foreground">
              {mode === "office"
                ? "H-Office events first, then company-wide events"
                : "The next commitments across active projects"}
            </p>
          </div>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link
            href={
              mode === "office"
                ? "/dashboard/schedule?kind=event"
                : "/dashboard/schedule?mode=projects&scope=all&view=gantt"
            }
          >
            Full calendar
            <IconArrowRight className="size-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 border-t sm:grid-cols-3 xl:grid-cols-5">
        {days.map((day, index) => {
          const dayTasks = horizonEntries.filter((task) =>
            taskFallsOnDay(task, day)
          )

          return (
            <div
              key={day}
              className={cn(
                "min-h-36 border-border/60 px-3 py-2.5",
                index > 0 && "border-l",
                index === 0 && "bg-[#2f5963]/[0.06]"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                    {formatDay(day)}
                  </p>
                  <p className="text-sm font-semibold">{formatMonthDay(day)}</p>
                </div>
                {index === 0 ? (
                  <span className="text-[10px] font-semibold uppercase text-[#2f5963]">
                    Today
                  </span>
                ) : null}
              </div>

              <div className="mt-2.5 space-y-2">
                {dayTasks.slice(0, 2).map((task) => (
                  <Link
                    key={`${day}-${task.id}`}
                    href={task.href}
                    className="block border-l-2 border-[#2f5963] pl-2 text-xs transition-colors hover:text-primary"
                  >
                    <span className="line-clamp-1 font-medium">{task.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {!task.allDay && task.startTime
                        ? `${task.startTime} · ${task.projectLabel}`
                        : task.projectLabel}
                    </span>
                  </Link>
                ))}
                {dayTasks.length === 0 ? (
                  <p className="pt-1 text-xs text-muted-foreground/70">
                    {mode === "office" ? "No office events" : "Open"}
                  </p>
                ) : null}
                {dayTasks.length > 2 ? (
                  <p className="text-[11px] font-medium text-muted-foreground">
                    +{dayTasks.length - 2} more
                  </p>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function DeskHero({
  user,
  today,
  status,
  onStatusChange,
}: {
  readonly user: SidebarUser | null
  readonly today: string
  readonly status: DeskStatus
  readonly onStatusChange: (status: DeskStatus) => void
}): React.ReactElement {
  const [deskPhotoFailed, setDeskPhotoFailed] = useState(false)
  const [deskPhotoUrl, setDeskPhotoUrl] = useState<string | null>(null)
  const [deskPhotoScope, setDeskPhotoScope] = useState<string | null>(null)
  const [deskPhotoMessage, setDeskPhotoMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isStatusPending, startStatusTransition] = useTransition()
  const firstName = user?.firstName ?? user?.name.split(" ")[0] ?? "there"

  useEffect(() => {
    setDeskPhotoFailed(false)
    setDeskPhotoUrl(deskPhotoForUser(user))
    setDeskPhotoScope(deskPhotoScopeForUser(user))

  }, [user])

  function handleStatusChange(nextStatus: DeskStatus): void {
    const previousStatus = status
    onStatusChange(nextStatus)
    setStatusMessage(null)
    startStatusTransition(async () => {
      const result = await updatePresence(
        presenceStatusForDeskStatus(nextStatus),
        DESK_STATUS_LABELS[nextStatus],
        true
      )
      if (!result.success) {
        onStatusChange(previousStatus)
        setStatusMessage(result.error)
      }
    })
  }

  async function handleDeskPhotoUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.currentTarget.files?.[0]
    if (!file || !user || !canManageDeskPhoto(user)) return
    event.currentTarget.value = ""

    if (!file.type.startsWith("image/")) {
      setDeskPhotoMessage("Choose an image file.")
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const resizedDataUrl = await resizeDeskPhoto(dataUrl)
      const result = await updateWorkspacePhoto("dashboard", resizedDataUrl)
      if (!result.success) {
        setDeskPhotoMessage(result.error)
        return
      }
      saveDeskPhoto(user, resizedDataUrl)
      setDeskPhotoFailed(false)
      setDeskPhotoUrl(resizedDataUrl)
      setDeskPhotoScope(deskPhotoScopeForUser(user))
      setDeskPhotoMessage("Desk photo updated.")
    } catch {
      setDeskPhotoMessage("Could not update the desk photo.")
    }
  }

  async function handleDeskPhotoReset(): Promise<void> {
    if (!user) return
    const result = await updateWorkspacePhoto(
      "dashboard",
      WORKSPACE_PHOTO_REMOVED
    )
    if (!result.success) {
      setDeskPhotoMessage(result.error)
      return
    }
    resetDeskPhoto(user)
    setDeskPhotoFailed(false)
    setDeskPhotoUrl(null)
    setDeskPhotoScope(null)
    setDeskPhotoMessage("Desk photo removed.")
  }

  const visibleDeskPhoto =
    user !== null &&
    user !== undefined &&
    canManageDeskPhoto(user) &&
    deskPhotoScopeForUser(user) === deskPhotoScope
      ? deskPhotoUrl
      : null

  return (
    <section className="grid min-h-52 overflow-hidden border-y border-border/70 bg-background sm:grid-cols-[minmax(10rem,0.8fr)_minmax(0,1.2fr)]">
      <div className="relative min-h-40 overflow-hidden bg-muted">
        {visibleDeskPhoto && !deskPhotoFailed ? (
          <Image
            src={visibleDeskPhoto}
            alt={`${firstName}'s desk`}
            fill
            sizes="(min-width: 1024px) 260px, 50vw"
            unoptimized
            className="object-cover"
            onError={() => setDeskPhotoFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#2f5963]/15 via-muted to-[#9d832c]/10">
            <IconHome2 className="size-10 text-[#2f5963]/60" />
          </div>
        )}
        {canManageDeskPhoto(user) ? (
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
            <label className="flex cursor-pointer items-center gap-1.5 border border-white/40 bg-black/55 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-black/70">
              <IconPhotoEdit className="size-3.5" />
              Change desk photo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleDeskPhotoUpload}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleDeskPhotoReset()}
              className="border border-white/40 bg-black/55 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-black/70"
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col justify-center px-5 py-4">
        <p className="text-xs text-muted-foreground">{formatLongDate(today)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {greetingForNow()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here is what needs your attention today.
        </p>
        {deskPhotoMessage ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {deskPhotoMessage}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => {
              if (isDeskStatus(value)) handleStatusChange(value)
            }}
          >
            <SelectTrigger className="h-8 w-36 bg-background text-xs">
              <span
                className={cn(
                  "size-2 rounded-full",
                  deskStatusDotClass(status)
                )}
              />
              <SelectValue>{DESK_STATUS_LABELS[status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DESK_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconHeartHandshake className="size-4 text-[#9d832c]" />
            {isStatusPending
              ? "Saving status..."
              : statusMessage ?? "CHERISH notes will appear here"}
          </span>
        </div>
      </div>
    </section>
  )
}

function CherishComposer(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [responseType, setResponseType] =
    useState<CherishPulseResponseType>("shoutout")
  const [message, setMessage] = useState("")
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const isPrivate = responseType === "concern"

  function handleSubmit(): void {
    const trimmedMessage = message.trim()
    if (trimmedMessage.length === 0) return

    startTransition(async () => {
      const result = await submitCherishPulseResponse({
        cherishValue: "Reliability",
        responseType,
        message: trimmedMessage,
        source: "compass_dashboard",
      })

      if (!result.success) {
        setResultMessage(result.error)
        return
      }

      setMessage("")
      setResultMessage(
        isPrivate
          ? "Your private concern was sent for leadership review."
          : "Your feedback was added to the CHERISH review queue."
      )
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-[#2f5963] hover:bg-[#244750]">
          <IconPlus className="size-4" />
          Give CHERISH feedback
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Give CHERISH feedback</DialogTitle>
          <DialogDescription>
            Share team recognition or send a private concern to leadership.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 border">
          <button
            type="button"
            onClick={() => setResponseType("shoutout")}
            className={cn(
              "px-3 py-2 text-sm font-medium transition-colors",
              responseType !== "concern" && "bg-[#2f5963] text-white"
            )}
          >
            Team recognition
          </button>
          <button
            type="button"
            onClick={() => setResponseType("concern")}
            className={cn(
              "border-l px-3 py-2 text-sm font-medium transition-colors",
              responseType === "concern" && "bg-[#9d832c] text-white"
            )}
          >
            Private concern
          </button>
        </div>

        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={
            isPrivate
              ? "What should leadership know?"
              : "Who deserves recognition, and what did they do?"
          }
          className="min-h-28"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {isPrivate ? "Private to leadership" : "Team-visible after review"}
          </p>
          <Button
            onClick={handleSubmit}
            disabled={message.trim().length === 0 || isPending}
          >
            {isPending ? "Sending..." : "Send feedback"}
          </Button>
        </div>
        {resultMessage ? (
          <p className="border-l-2 border-emerald-700 pl-2 text-xs text-muted-foreground">
            {resultMessage}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function OfficeTaskList({
  overview,
  officeCalendarEvents,
  officeProjectId,
}: {
  readonly overview: DashboardOverview
  readonly officeCalendarEvents: readonly DashboardOfficeEvent[]
  readonly officeProjectId: string | null
}): React.ReactElement {
  const tasks = useMemo<readonly LaunchpadTask[]>(() => {
    const eventTasks: readonly LaunchpadTask[] = officeCalendarEvents
      .slice()
      .filter((event) => event.endDate >= overview.today)
      .sort((left, right) =>
        compareOfficeCalendarPriority(left, right, officeProjectId)
      )
      .slice(0, 3)
      .map((event) => ({
        id: `event-${event.id}`,
        title: event.title,
        detail: `${event.projectLabel} · ${formatMonthDay(event.startDate)}`,
        href: event.href,
        category: "Event",
      }))
    const operationTasks: readonly LaunchpadTask[] = overview.operations
      .slice()
      .sort(compareOfficePriority)
      .slice(0, 3)
      .map((operation) => ({
        id: `operation-${operation.id}`,
        title: operation.title,
        detail: `${operation.projectLabel}${operation.companyName ? ` · ${operation.companyName}` : ""}`,
        href:
          operation.type === "purchase_order"
            ? projectPurchaseOrderHref(operation.projectId, operation.id)
            : isProjectTodoRecordType(operation.type)
              ? projectTodoHref(operation.projectId, operation.id)
              : `/dashboard/projects/${operation.projectId}`,
        category: "Invoice",
      }))
    const ownerUpdateTasks: readonly LaunchpadTask[] =
      overview.metrics.draftOwnerUpdates > 0
        ? [{
            id: "draft-owner-updates",
            title: `Review ${overview.metrics.draftOwnerUpdates} draft owner update${overview.metrics.draftOwnerUpdates === 1 ? "" : "s"}`,
            detail: "Publication queue",
            href: "/dashboard/projects",
            category: "Owner update",
          }]
        : []
    const photoTasks: readonly LaunchpadTask[] =
      overview.metrics.photosToReview > 0
        ? [{
            id: "field-photo-review",
            title: `Review ${overview.metrics.photosToReview} field photo${overview.metrics.photosToReview === 1 ? "" : "s"}`,
            detail: "Visibility decisions",
            href: "/dashboard/projects/select?target=photos",
            category: "Field review",
          }]
        : []

    return [
      ...eventTasks,
      ...ownerUpdateTasks,
      ...operationTasks,
      ...photoTasks,
    ].slice(0, 6)
  }, [officeCalendarEvents, officeProjectId, overview])

  return (
    <section className="min-w-0 border-y border-border/70 bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Office priorities</h2>
          <p className="text-xs text-muted-foreground">
            Reviews and follow-ups requiring action
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/schedule?focus=tasks">All to-dos</Link>
        </Button>
      </div>

      <div className="divide-y border-t">
        {tasks.map((task) => (
          <Link
            key={task.id}
            href={task.href}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
          >
            <span className="flex size-5 shrink-0 items-center justify-center border text-muted-foreground">
              <IconArrowRight className="size-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {task.title}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {task.detail}
              </span>
            </span>
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
              {task.category}
            </Badge>
          </Link>
        ))}
        {tasks.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <IconCheck className="mx-auto size-5 text-emerald-700" />
            <p className="mt-2 text-sm font-medium">Office queue is clear</p>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function OfficePresence({
  initialAvailability,
  user,
  status,
}: {
  readonly initialAvailability: readonly TeamAvailabilityMember[]
  readonly user: SidebarUser | null
  readonly status: DeskStatus
}): React.ReactElement {
  const { isIdle } = usePresence()
  const currentActivity = isIdle ? "idle" : "active"
  const [members, setMembers] = useState<readonly TeamAvailabilityMember[]>(
    () =>
      includeCurrentAvailability(
        initialAvailability,
        user,
        status,
        currentActivity
      )
  )
  const [isRefreshing, startRefreshTransition] = useTransition()

  const refreshAvailability = useCallback(() => {
    startRefreshTransition(async () => {
      const result = await getOrganizationTeamAvailability()
      if (!result.success) return
      setMembers(
        includeCurrentAvailability(
          result.data,
          user,
          status,
          currentActivity
        )
      )
    })
  }, [currentActivity, status, user])

  useEffect(() => {
    setMembers((current) =>
      includeCurrentAvailability(current, user, status, currentActivity)
    )
  }, [currentActivity, status, user])

  useEffect(() => {
    refreshAvailability()
    const refreshTimer = window.setInterval(
      refreshAvailability,
      TEAM_AVAILABILITY_REFRESH_MS
    )
    const handleVisibilityChange = (): void => {
      if (!document.hidden) refreshAvailability()
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(refreshTimer)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [refreshAvailability])

  return (
    <section className="border-y border-border/70 bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Who&apos;s in today</h2>
          <p className="text-xs text-muted-foreground">
            {isRefreshing ? "Updating team availability..." : "Updates automatically"}
          </p>
        </div>
        <IconUsers className="size-5 text-muted-foreground" />
      </div>
      <div className="max-h-64 divide-y overflow-y-auto border-t">
        {members.map((member) => (
          <div
            key={member.userId}
            data-team-availability-user={member.userId}
            className="flex items-center gap-3 px-4 py-3"
          >
            <div className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
              {member.avatarUrl ? (
                <Image
                  src={member.avatarUrl}
                  alt=""
                  fill
                  sizes="32px"
                  unoptimized
                  className="object-cover"
                />
              ) : (
                member.name.slice(0, 1).toUpperCase()
              )}
            </div>
            <span
              className={cn(
                "-ml-4 mt-6 size-2.5 shrink-0 rounded-full ring-2 ring-background",
                deskStatusDotClass(member.status)
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {member.name}
                {member.isCurrentUser ? (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (You)
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {member.activity === "idle"
                  ? `${DESK_STATUS_LABELS[member.status]} · Idle`
                  : DESK_STATUS_LABELS[member.status]}
              </p>
            </div>
          </div>
        ))}
        {members.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No team availability has been set yet.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function OfficeAlerts({
  overview,
}: {
  readonly overview: DashboardOverview
}): React.ReactElement {
  const alerts = [
    {
      label: "Open RFIs",
      value: overview.metrics.openRfis,
      href: "/dashboard/rfis",
      icon: <IconMessageCircleQuestion className="size-4" />,
    },
    {
      label: "Draft owner updates",
      value: overview.metrics.draftOwnerUpdates,
      href: "/dashboard/projects",
      icon: <IconClipboardText className="size-4" />,
    },
    {
      label: "Photos to review",
      value: overview.metrics.photosToReview,
      href: "/dashboard/projects/select?target=photos",
      icon: <IconPhoto className="size-4" />,
    },
  ]

  return (
    <section className="border-y border-border/70 bg-background">
      <div className="flex items-center gap-2 px-4 py-3">
        <IconAlertTriangle className="size-4 text-[#9d832c]" />
        <div>
          <h2 className="text-sm font-semibold">Office alerts</h2>
          <p className="text-xs text-muted-foreground">Items that may need escalation</p>
        </div>
      </div>
      <div className="divide-y border-t">
        {alerts.map((alert) => (
          <Link
            key={alert.label}
            href={alert.href}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
          >
            <span className="text-muted-foreground">{alert.icon}</span>
            <span className="flex-1 text-sm">{alert.label}</span>
            <span className="font-semibold tabular-nums">{alert.value}</span>
            <IconArrowRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  )
}

function QuickDock(): React.ReactElement {
  const actions = [
    {
      label: "Review POs",
      href: "/dashboard/purchase-orders",
      icon: <IconReceipt className="size-4" />,
    },
    {
      label: "Create to-do",
      href: "/dashboard/schedule?focus=tasks",
      icon: <IconChecklist className="size-4" />,
    },
    {
      label: "Daily logs",
      href: "/dashboard/projects/select?target=daily-logs",
      icon: <IconClipboardText className="size-4" />,
    },
    {
      label: "Files",
      href: "/dashboard/files",
      icon: <IconFileInvoice className="size-4" />,
    },
  ]

  return (
    <section className="border-y border-border/70 bg-background">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold">Quick dock</h2>
        <p className="text-xs text-muted-foreground">Frequent office actions</p>
      </div>
      <div className="grid grid-cols-2 border-t">
        {actions.map((action, index) => (
          <Link
            key={action.label}
            href={action.href}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50",
              index % 2 === 1 && "border-l",
              index > 1 && "border-t"
            )}
          >
            <span className="text-[#2f5963]">{action.icon}</span>
            {action.label}
          </Link>
        ))}
      </div>
    </section>
  )
}

function ProjectWorkspace({
  overview,
}: {
  readonly overview: DashboardOverview
}): React.ReactElement {
  const priorityProjects = useMemo(
    () =>
      overview.projects
        .map((project) => ({
          project,
          score:
            project.openRfiCount * 5 +
            project.photosToReview * 3 +
            project.openPoCount * 2 +
            (project.nextTask ? 1 : 0),
        }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5),
    [overview.projects]
  )

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
      <section className="min-w-0 border-y border-border/70 bg-background">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Projects needing attention</h2>
            <p className="text-xs text-muted-foreground">
              Ranked by decisions, reviews, and active commitments
            </p>
          </div>
          <Badge variant="outline">{priorityProjects.length}</Badge>
        </div>
        <div className="divide-y border-t">
          {priorityProjects.map(({ project }) => (
            <Link
              key={project.id}
              href={`/dashboard/projects/${project.id}`}
              className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {project.projectNumber ?? project.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {project.name}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {project.nextTask?.title ?? "No upcoming schedule item"}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span><strong>{project.openRfiCount}</strong> RFIs</span>
                <span><strong>{project.photosToReview}</strong> photos</span>
                <span><strong>{project.progress}%</strong></span>
                <IconArrowRight className="size-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
          {priorityProjects.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No active project exceptions.
            </p>
          ) : null}
        </div>
      </section>

      <section className="min-w-0 border-y border-border/70 bg-background">
        <div className="flex items-center gap-2 px-4 py-3">
          <IconMessageCircleQuestion className="size-4 text-[#9d832c]" />
          <div>
            <h2 className="text-sm font-semibold">Decision queue</h2>
            <p className="text-xs text-muted-foreground">Open RFIs requiring follow-up</p>
          </div>
        </div>
        <div className="divide-y border-t">
          {overview.openRfis.slice(0, 5).map((rfi) => (
            <Link
              key={rfi.id}
              href={`/dashboard/projects/${rfi.projectId}/rfis`}
              className="block px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold">{rfi.rfiNumber}</span>
                <span className="text-[11px] text-muted-foreground">
                  {rfi.dueDate ? formatMonthDay(rfi.dueDate) : "No due date"}
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-sm font-medium">{rfi.subject}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {rfi.projectLabel}
              </p>
            </Link>
          ))}
          {overview.openRfis.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              The decision queue is clear.
            </p>
          ) : null}
        </div>
      </section>

      <section className="min-w-0 border-y border-border/70 bg-background xl:col-span-2">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <IconPhoto className="size-4 text-[#2f5963]" />
            <div>
              <h2 className="text-sm font-semibold">Recent site activity</h2>
              <p className="text-xs text-muted-foreground">
                Approved field photos across active projects
              </p>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/projects/select?target=photos">All photos</Link>
          </Button>
        </div>
        <div className="grid gap-px border-t bg-border sm:grid-cols-2 lg:grid-cols-4">
          {overview.fieldPhotos.slice(0, 4).map((photo) => (
            <Link
              key={photo.id}
              href={`/dashboard/projects/${photo.projectId}/photos`}
              className="group bg-background"
            >
              <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                <Image
                  src={photo.imageUrl}
                  alt={photo.caption ?? photo.fileName}
                  fill
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  unoptimized
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <div className="px-3 py-2">
                <p className="truncate text-xs font-medium">
                  {photo.caption ?? photo.fileName}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {photo.projectLabel}
                </p>
              </div>
            </Link>
          ))}
          {overview.fieldPhotos.length === 0 ? (
            <div className="col-span-full px-4 py-8 text-center text-sm text-muted-foreground">
              No approved field photos are available.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function TeamPulseDrawer({
  overview,
}: {
  readonly overview: DashboardOverview
}): React.ReactElement {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <IconUsers className="size-4" />
          Team Pulse
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Team Pulse</SheetTitle>
          <SheetDescription>
            Team recognition, field activity, and current availability.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <div className="border-y py-4">
            <div className="flex items-center gap-2">
              <IconUserHeart className="size-5 text-emerald-700" />
              <h3 className="text-sm font-semibold">CHERISH</h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Recognize a teammate or privately let leadership know where help
              is needed.
            </p>
            <div className="mt-3">
              <CherishComposer />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Today at a glance
            </p>
            <div className="mt-3 divide-y border-y">
              <div className="flex items-center justify-between py-3 text-sm">
                <span>Active projects</span>
                <strong>{overview.metrics.activeProjects}</strong>
              </div>
              <div className="flex items-center justify-between py-3 text-sm">
                <span>Upcoming commitments</span>
                <strong>{overview.metrics.upcomingTasks}</strong>
              </div>
              <div className="flex items-center justify-between py-3 text-sm">
                <span>Photos to review</span>
                <strong>{overview.metrics.photosToReview}</strong>
              </div>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Public team recognition will appear here after review. Private
            concerns remain visible only to authorized leadership.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function DashboardLaunchpad({
  overview,
  user,
  initialDeskStatusMessage,
  initialTeamAvailability,
  officeCalendarEvents,
  officeProjectId,
  canManageOfficeMaintenance,
}: {
  readonly overview: DashboardOverview
  readonly user: SidebarUser | null
  readonly initialDeskStatusMessage: string | null
  readonly initialTeamAvailability: readonly TeamAvailabilityMember[]
  readonly officeCalendarEvents: readonly DashboardOfficeEvent[]
  readonly officeProjectId: string | null
  readonly canManageOfficeMaintenance: boolean
}): React.ReactElement {
  const [mode, setMode] = useState<DashboardMode>("office")
  const [deskStatus, setDeskStatus] = useState<DeskStatus>(() =>
    deskStatusForPresenceMessage(initialDeskStatusMessage)
  )

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 p-3 sm:p-4 lg:p-5">
      <div className="flex flex-col gap-3 border-b pb-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconSparkles className="size-4 text-[#9d832c]" />
            <p className="text-sm font-semibold">Morning launchpad</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A focused start to the workday
          </p>
        </div>

        <div className="grid grid-cols-2 border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setMode("office")}
            className={cn(
              "flex h-8 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors",
              mode === "office" && "bg-background text-foreground shadow-sm"
            )}
          >
            <IconBuilding className="size-4" />
            Office
          </button>
          <button
            type="button"
            onClick={() => setMode("project")}
            className={cn(
              "flex h-8 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors",
              mode === "project" && "bg-background text-foreground shadow-sm"
            )}
          >
            <IconBuildingSkyscraper className="size-4" />
            Projects
          </button>
        </div>

        <div className="flex items-center gap-2 lg:justify-end">
          {canManageOfficeMaintenance ? (
            <OfficeMaintenanceDrawer projects={overview.projects} />
          ) : null}
          <CherishComposer />
          <TeamPulseDrawer overview={overview} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.72fr)_minmax(0,1.28fr)]">
        <DeskHero
          user={user}
          today={overview.today}
          status={deskStatus}
          onStatusChange={setDeskStatus}
        />
        <Horizon
          overview={overview}
          mode={mode}
          officeCalendarEvents={officeCalendarEvents}
          officeProjectId={officeProjectId}
        />
      </div>

      {mode === "office" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
          <OfficeTaskList
            overview={overview}
            officeCalendarEvents={officeCalendarEvents}
            officeProjectId={officeProjectId}
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <OfficePresence
              initialAvailability={initialTeamAvailability}
              user={user}
              status={deskStatus}
            />
            <OfficeAlerts overview={overview} />
            <QuickDock />
          </div>
        </div>
      ) : (
        <ProjectWorkspace overview={overview} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <IconMapPin className="size-3.5" />
          Live Compass dashboard data
        </span>
        <Link href="/dashboard/projects" className="font-medium hover:text-foreground">
          Open Project Hub
        </Link>
      </div>
    </main>
  )
}
