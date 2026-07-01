"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconArrowLeft,
  IconCalendarStats,
  IconClipboardText,
  IconCloud,
  IconExternalLink,
  IconFileText,
  IconMailForward,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconShieldCheck,
  IconUpload,
  IconUsers,
} from "@tabler/icons-react"

import {
  createProjectDailyLog,
  draftOwnerUpdateFromDailyLogs,
  getProjectWeatherSnapshot,
  updateDailyLogReview,
  updateProjectDailyLog,
  type ProjectDailyLogItem,
  type ProjectDailyLogPhoto,
  type ProjectDailyLogWorkspace as ProjectDailyLogWorkspaceData,
} from "@/app/actions/project-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import {
  photoLinkHref,
  resolvePhotoImageSource,
} from "@/lib/photo-sources"
import { cn } from "@/lib/utils"

type LogFilter = "all" | "needs_review" | "approved" | "owner_visible"

const MAX_DAILY_LOG_UPLOAD_BYTES = 50 * 1024 * 1024

type DailyLogDraft = {
  readonly logDate: string
  readonly weatherTempF: string
  readonly weatherConditions: string
  readonly weatherPrecipitation: string
  readonly workCompleted: string
  readonly crewPresent: string
  readonly hoursWorked: string
  readonly materialsUsed: string
  readonly issues: string
  readonly safetyIncidents: string
  readonly visitorLog: string
  readonly notes: string
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyDailyLogDraft(): DailyLogDraft {
  return {
    logDate: todayInputValue(),
    weatherTempF: "",
    weatherConditions: "",
    weatherPrecipitation: "",
    workCompleted: "",
    crewPresent: "",
    hoursWorked: "",
    materialsUsed: "",
    issues: "",
    safetyIncidents: "",
    visitorLog: "",
    notes: "",
  }
}

function draftFromLog(log: ProjectDailyLogItem): DailyLogDraft {
  return {
    logDate: log.logDate,
    weatherTempF: log.weatherTempF === null ? "" : String(log.weatherTempF),
    weatherConditions: log.weatherConditions ?? "",
    weatherPrecipitation: log.weatherPrecipitation ?? "",
    workCompleted: log.workCompleted,
    crewPresent: log.crewPresent ?? "",
    hoursWorked: log.hoursWorked === null ? "" : String(log.hoursWorked),
    materialsUsed: log.materialsUsed ?? "",
    issues: log.issues ?? "",
    safetyIncidents: log.safetyIncidents ?? "",
    visitorLog: log.visitorLog ?? "",
    notes: log.notes ?? "",
  }
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function sourceLabel(value: string): string {
  switch (value) {
    case "buildertrend":
      return "Buildertrend"
    case "google_daily_log":
      return "Google daily log"
    case "google_drive":
      return "Google Drive"
    case "telegram":
      return "Telegram"
    case "mobile":
      return "Mobile"
    default:
      return "Compass"
  }
}

function readableJsonItem(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return null

  const company =
    "company" in value && typeof value.company === "string"
      ? value.company
      : null
  const count =
    "count" in value && typeof value.count === "number"
      ? value.count
      : null

  if (company && count !== null) return `${company} (${count})`
  if (company) return company
  return null
}

function readableField(value: string | null): string | null {
  if (value === null || value.length === 0) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      const parts = parsed
        .map(readableJsonItem)
        .filter((part): part is string => part !== null && part.length > 0)
      return parts.length > 0 ? parts.join(", ") : value
    }
    return value
  } catch {
    return value
  }
}

function filterValue(value: string): LogFilter {
  switch (value) {
    case "needs_review":
    case "approved":
    case "owner_visible":
      return value
    default:
      return "all"
  }
}

function matchesFilter(log: ProjectDailyLogItem, filter: LogFilter): boolean {
  switch (filter) {
    case "needs_review":
      return log.reviewStatus === "needs_review"
    case "approved":
      return log.reviewStatus === "approved"
    case "owner_visible":
      return log.isClientVisible
    case "all":
      return true
  }
}

function matchesDateRange(value: string, from: string, to: string): boolean {
  return (from.length === 0 || value >= from) && (to.length === 0 || value <= to)
}

function matchesDailyLogSearch(log: ProjectDailyLogItem, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return true

  const searchable = [
    log.logDate,
    log.sourceSystem,
    log.workCompleted,
    log.weather,
    log.issues,
    log.materialsUsed,
    log.crewPresent,
    log.safetyIncidents,
    log.visitorLog,
    log.notes,
    log.authorName,
    ...log.photos.map((photo) => photo.fileName),
    ...log.tasks.map((task) => task.title),
  ]

  return searchable.some((value) =>
    (value ?? "").toLowerCase().includes(normalized)
  )
}

function selectedLogIds(
  logs: readonly ProjectDailyLogItem[],
  selectedIds: readonly string[]
): readonly string[] {
  const availableIds = new Set(logs.map((log) => log.id))
  return selectedIds.filter((id) => availableIds.has(id))
}

function LogMetric({
  label,
  value,
  icon,
}: {
  readonly label: string
  readonly value: number
  readonly icon: React.ReactNode
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span>{icon}</span>
        <p className="truncate text-xs font-medium uppercase">{label}</p>
      </div>
      <p className="mt-1 text-xl font-semibold leading-none tabular-nums">
        {value}
      </p>
    </div>
  )
}

function DailyLogDetail({
  label,
  children,
  wide = false,
}: {
  readonly label: string
  readonly children: React.ReactNode
  readonly wide?: boolean
}): React.ReactElement {
  return (
    <div
      className={cn(
        "min-w-0 border-l-2 border-border bg-muted/15 py-2 pl-3 pr-4",
        wide && "md:col-span-2 xl:col-span-3"
      )}
    >
      <dt className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
        {children}
      </dd>
    </div>
  )
}

function DailyLogFields({
  draft,
  idPrefix,
  updateDraft,
}: {
  readonly draft: DailyLogDraft
  readonly idPrefix: string
  readonly updateDraft: (field: keyof DailyLogDraft, value: string) => void
}): React.ReactElement {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-[160px_110px_1fr_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-date`}>Date</Label>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={draft.logDate}
            onChange={(event) =>
              updateDraft("logDate", event.currentTarget.value)
            }
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-temp`}>Temp</Label>
          <Input
            id={`${idPrefix}-temp`}
            inputMode="numeric"
            value={draft.weatherTempF}
            onChange={(event) =>
              updateDraft("weatherTempF", event.currentTarget.value)
            }
            placeholder="F"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-weather`}>Weather</Label>
          <Input
            id={`${idPrefix}-weather`}
            value={draft.weatherConditions}
            onChange={(event) =>
              updateDraft("weatherConditions", event.currentTarget.value)
            }
            placeholder="Sunny, cloudy, windy..."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-precipitation`}>Precipitation</Label>
          <Input
            id={`${idPrefix}-precipitation`}
            value={draft.weatherPrecipitation}
            onChange={(event) =>
              updateDraft("weatherPrecipitation", event.currentTarget.value)
            }
            placeholder="Optional field note..."
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-work`}>Work completed</Label>
        <Textarea
          id={`${idPrefix}-work`}
          value={draft.workCompleted}
          onChange={(event) =>
            updateDraft("workCompleted", event.currentTarget.value)
          }
          placeholder="Summarize progress, crews, inspections, and important field activity."
          className="min-h-28"
          required
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-crew`}>Crew present</Label>
          <Textarea
            id={`${idPrefix}-crew`}
            value={draft.crewPresent}
            onChange={(event) =>
              updateDraft("crewPresent", event.currentTarget.value)
            }
            placeholder="Companies, names, counts..."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-hours`}>Hours worked</Label>
          <Input
            id={`${idPrefix}-hours`}
            inputMode="decimal"
            value={draft.hoursWorked}
            onChange={(event) =>
              updateDraft("hoursWorked", event.currentTarget.value)
            }
            placeholder="Total hours"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-materials`}>Materials</Label>
          <Textarea
            id={`${idPrefix}-materials`}
            value={draft.materialsUsed}
            onChange={(event) =>
              updateDraft("materialsUsed", event.currentTarget.value)
            }
            placeholder="Deliveries, materials used, shortages..."
          />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-issues`}>Issues</Label>
          <Textarea
            id={`${idPrefix}-issues`}
            value={draft.issues}
            onChange={(event) =>
              updateDraft("issues", event.currentTarget.value)
            }
            placeholder="Delays, conflicts, blockers..."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-safety`}>Safety</Label>
          <Textarea
            id={`${idPrefix}-safety`}
            value={draft.safetyIncidents}
            onChange={(event) =>
              updateDraft("safetyIncidents", event.currentTarget.value)
            }
            placeholder="Incidents or no incidents."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-visitors`}>Visitors</Label>
          <Textarea
            id={`${idPrefix}-visitors`}
            value={draft.visitorLog}
            onChange={(event) =>
              updateDraft("visitorLog", event.currentTarget.value)
            }
            placeholder="Owners, inspectors, suppliers..."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-notes`}>Notes / Next</Label>
          <Textarea
            id={`${idPrefix}-notes`}
            value={draft.notes}
            onChange={(event) =>
              updateDraft("notes", event.currentTarget.value)
            }
            placeholder="Follow-ups and next steps."
            rows={5}
          />
        </div>
      </div>
    </>
  )
}

function DailyLogPhotoThumb({
  photo,
}: {
  readonly photo: ProjectDailyLogPhoto
}): React.ReactElement {
  const [imageFailed, setImageFailed] = React.useState(false)
  const resolvedImage = resolvePhotoImageSource(photo)
  const imageSrc = imageFailed ? null : resolvedImage.src

  if (imageSrc !== null) {
    return (
      <Image
        src={imageSrc}
        alt={photo.caption ?? photo.fileName}
        fill
        sizes="160px"
        unoptimized
        className="object-cover transition-transform group-hover:scale-[1.03]"
        onError={() => setImageFailed(true)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
      <IconFileText className="size-6" />
      <span className="line-clamp-3 break-words">
        {resolvedImage.reason === "missing"
          ? photo.caption ?? photo.fileName
          : resolvedImage.label}
      </span>
    </div>
  )
}

function PhotoStrip({
  log,
}: {
  readonly log: ProjectDailyLogItem
}): React.ReactElement | null {
  if (log.photos.length === 0) return null

  const ownerVisibleCount = log.photos.filter((photo) => photo.ownerVisible).length

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <IconPhoto className="size-3.5" />
        <span>
          {log.photos.length} file{log.photos.length === 1 ? "" : "s"} tied to
          this log
        </span>
        <span>&middot;</span>
        <span>{ownerVisibleCount} owner visible</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {log.photos.slice(0, 6).map((photo) => {
          const href = photoLinkHref(photo.driveUrl, {
            allowExternalSource: true,
          })
          return (
            <a
              key={photo.id}
              href={href ?? undefined}
              target={href ? "_blank" : undefined}
              rel={href ? "noreferrer" : undefined}
              className={cn(
                "group relative aspect-[4/3] overflow-hidden rounded-md border bg-muted",
                href ? "cursor-pointer" : "cursor-default"
              )}
            >
              <DailyLogPhotoThumb photo={photo} />
              <div className="absolute inset-x-0 bottom-0 bg-background/85 px-2 py-1 text-[11px]">
                {photo.ownerVisible ? "Owner visible" : statusLabel(photo.reviewStatus)}
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}

export function ProjectDailyLogWorkspace({
  workspace,
}: {
  readonly workspace: ProjectDailyLogWorkspaceData
}): React.ReactElement {
  const router = useRouter()
  const [logs, setLogs] =
    React.useState<readonly ProjectDailyLogItem[]>(workspace.logs)
  const [filter, setFilter] = React.useState<LogFilter>("all")
  const [searchText, setSearchText] = React.useState("")
  const [fromDate, setFromDate] = React.useState("")
  const [toDate, setToDate] = React.useState("")
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([])
  const [showNewLog, setShowNewLog] = React.useState(false)
  const [draft, setDraft] = React.useState<DailyLogDraft>(emptyDailyLogDraft)
  const [editingLogId, setEditingLogId] = React.useState<string | null>(null)
  const [editDraft, setEditDraft] =
    React.useState<DailyLogDraft>(emptyDailyLogDraft)
  const [uploadingLogId, setUploadingLogId] = React.useState<string | null>(null)
  const [uploadFiles, setUploadFiles] = React.useState<readonly File[]>([])
  const [uploadCaption, setUploadCaption] = React.useState("")
  const [uploadMessage, setUploadMessage] = React.useState<string | null>(null)
  const [isUploading, setUploading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const [isWeatherPending, startWeatherTransition] = React.useTransition()

  React.useEffect(() => {
    setLogs(workspace.logs)
    setSelectedIds([])
    setEditingLogId(null)
    setUploadingLogId(null)
  }, [workspace.logs])

  const filteredLogs = React.useMemo(
    () =>
      logs.filter(
        (log) =>
          matchesFilter(log, filter) &&
          matchesDateRange(log.logDate, fromDate, toDate) &&
          matchesDailyLogSearch(log, searchText)
      ),
    [filter, fromDate, logs, searchText, toDate]
  )
  const selectedIdsInView = selectedLogIds(filteredLogs, selectedIds)
  const projectLabel = workspace.project.projectNumber ?? workspace.project.name

  function toggleLog(logId: string): void {
    setSelectedIds((current) =>
      current.includes(logId)
        ? current.filter((id) => id !== logId)
        : [...current, logId]
    )
  }

  function selectVisibleLogs(): void {
    setSelectedIds(filteredLogs.map((log) => log.id))
  }

  function clearSelection(): void {
    setSelectedIds([])
  }

  function updateDraft(field: keyof DailyLogDraft, value: string): void {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function updateEditDraft(field: keyof DailyLogDraft, value: string): void {
    setEditDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function startEditingLog(log: ProjectDailyLogItem): void {
    setMessage(null)
    setShowNewLog(false)
    setEditingLogId(log.id)
    setEditDraft(draftFromLog(log))
  }

  function cancelEditingLog(): void {
    setEditingLogId(null)
    setEditDraft(emptyDailyLogDraft())
  }

  function startUploadingFiles(log: ProjectDailyLogItem): void {
    setMessage(null)
    setUploadMessage(null)
    setUploadingLogId(log.id)
    setUploadFiles([])
    setUploadCaption("")
  }

  function cancelUploadingFiles(): void {
    setUploadingLogId(null)
    setUploadFiles([])
    setUploadCaption("")
    setUploadMessage(null)
  }

  function chooseUploadFiles(fileList: FileList | null): void {
    setUploadFiles(fileList === null ? [] : Array.from(fileList))
  }

  async function uploadDailyLogFiles(log: ProjectDailyLogItem): Promise<void> {
    if (uploadFiles.length === 0) {
      setUploadMessage("Choose at least one photo or document.")
      return
    }

    const oversizedFile = uploadFiles.find(
      (file) => file.size > MAX_DAILY_LOG_UPLOAD_BYTES
    )
    if (oversizedFile) {
      setUploadMessage(
        `${oversizedFile.name} is ${formatBytes(
          oversizedFile.size
        )}. Upload files under 50 MB each.`
      )
      return
    }

    setUploading(true)
    setUploadMessage(null)

    try {
      const formData = new FormData()
      for (const file of uploadFiles) {
        formData.append("files", file)
      }
      formData.set("dailyLogId", log.id)
      formData.set("caption", uploadCaption)
      formData.set("capturedDate", log.logDate)
      formData.set("photoKind", "progress")

      const response = await fetch(
        `/api/projects/${workspace.project.id}/photos/upload`,
        {
          method: "POST",
          body: formData,
        }
      )
      const result: unknown = await response.json()

      if (
        typeof result === "object" &&
        result !== null &&
        "success" in result &&
        result.success === true
      ) {
        const uploadedCount =
          "uploadedCount" in result && typeof result.uploadedCount === "number"
            ? result.uploadedCount
            : uploadFiles.length
        setUploadMessage(
          `Uploaded ${uploadedCount} file${
            uploadedCount === 1 ? "" : "s"
          } to Google Drive.`
        )
        setUploadFiles([])
        setUploadCaption("")
        router.refresh()
        return
      }

      const error =
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "Unable to upload files."
      setUploadMessage(error)
    } catch {
      setUploadMessage("Unable to upload files.")
    } finally {
      setUploading(false)
    }
  }

  function submitDailyLog(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setMessage(null)

    if (draft.workCompleted.trim().length === 0) {
      setMessage("Work completed is required before saving a daily log.")
      return
    }

    startTransition(async () => {
      const result = await createProjectDailyLog(workspace.project.id, {
        logDate: draft.logDate,
        weatherTempF: optionalNumber(draft.weatherTempF),
        weatherConditions: draft.weatherConditions,
        weatherPrecipitation: draft.weatherPrecipitation,
        workCompleted: draft.workCompleted,
        crewPresent: draft.crewPresent,
        hoursWorked: optionalNumber(draft.hoursWorked),
        materialsUsed: draft.materialsUsed,
        issues: draft.issues,
        safetyIncidents: draft.safetyIncidents,
        visitorLog: draft.visitorLog,
        notes: draft.notes,
      })

      if (result.success) {
        setDraft(emptyDailyLogDraft())
        setShowNewLog(false)
        setMessage("Daily log saved. Review it before making it owner visible.")
        router.refresh()
      } else {
        setMessage(result.error)
      }
    })
  }

  function submitDailyLogEdit(
    event: React.FormEvent<HTMLFormElement>,
    log: ProjectDailyLogItem
  ): void {
    event.preventDefault()
    setMessage(null)

    if (editDraft.workCompleted.trim().length === 0) {
      setMessage("Work completed is required before saving a daily log.")
      return
    }

    startTransition(async () => {
      const result = await updateProjectDailyLog(workspace.project.id, {
        dailyLogId: log.id,
        logDate: editDraft.logDate,
        weatherTempF: optionalNumber(editDraft.weatherTempF),
        weatherConditions: editDraft.weatherConditions,
        weatherPrecipitation: editDraft.weatherPrecipitation,
        workCompleted: editDraft.workCompleted,
        crewPresent: editDraft.crewPresent,
        hoursWorked: optionalNumber(editDraft.hoursWorked),
        materialsUsed: editDraft.materialsUsed,
        issues: editDraft.issues,
        safetyIncidents: editDraft.safetyIncidents,
        visitorLog: editDraft.visitorLog,
        notes: editDraft.notes,
      })

      if (result.success) {
        cancelEditingLog()
        setMessage("Daily log updated and returned to review.")
        router.refresh()
      } else {
        setMessage(result.error)
      }
    })
  }

  function useProjectWeather(): void {
    setMessage(null)
    startWeatherTransition(async () => {
      const result = await getProjectWeatherSnapshot(workspace.project.id, {
        logDate: draft.logDate,
      })

      if (!result.success) {
        setMessage(result.error)
        return
      }

      setDraft((current) => ({
        ...current,
        weatherTempF:
          result.weather.tempF === null ? "" : String(result.weather.tempF),
        weatherConditions: result.weather.conditions,
      }))
      setMessage(
        [
          `Weather filled from ${result.weather.source}`,
          result.weather.station ? `station ${result.weather.station}` : null,
          result.weather.locationLabel
            ? `near ${result.weather.locationLabel}`
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(" ")
          .concat(".")
      )
    })
  }

  function updateReview(
    log: ProjectDailyLogItem,
    reviewStatus: string,
    isClientVisible: boolean
  ): void {
    setMessage(null)
    startTransition(async () => {
      const result = await updateDailyLogReview(workspace.project.id, {
        dailyLogId: log.id,
        reviewStatus,
        isClientVisible,
      })

      if (result.success) {
        setLogs((current) =>
          current.map((item) =>
            item.id === log.id
              ? {
                  ...item,
                  reviewStatus,
                  isClientVisible,
                }
              : item
          )
        )
        setMessage("Daily log review updated.")
      } else {
        setMessage(result.error)
      }
    })
  }

  function draftOwnerUpdate(): void {
    const dailyLogIds = selectedIdsInView
    setMessage(null)
    startTransition(async () => {
      const result = await draftOwnerUpdateFromDailyLogs(workspace.project.id, {
        dailyLogIds,
      })

      if (result.success) {
        router.push(
          `/dashboard/projects/${workspace.project.id}/owner-updates/${result.updateId}`
        )
      } else {
        setMessage(result.error)
      }
    })
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href={`/dashboard/projects/${workspace.project.id}`}>
                <IconArrowLeft className="size-4" />
                Project
              </Link>
            </Button>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Daily Logs
            </h1>
            <p className="text-sm text-muted-foreground">
              {projectLabel}
              {workspace.project.clientName
                ? ` · ${workspace.project.clientName}`
                : ""}{" "}
              · Review field notes, attached photos, and owner update readiness.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <ProjectContextSwitcher
              currentProjectId={workspace.project.id}
              targetSection="daily-logs"
              placeholder="Switch daily log project..."
              className="w-full sm:w-[280px]"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant={showNewLog ? "secondary" : "default"}
                size="sm"
                onClick={() => setShowNewLog((current) => !current)}
              >
                <IconPlus className="size-4" />
                New daily log
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/projects/${workspace.project.id}/photos`}>
                  <IconPhoto className="size-4" />
                  Photo review
                </Link>
              </Button>
              <Button
                size="sm"
                onClick={draftOwnerUpdate}
                disabled={isPending || selectedIdsInView.length === 0}
              >
                <IconMailForward className="size-4" />
                Draft owner update
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-y py-3 lg:grid-cols-6">
          <LogMetric
            label="Logs"
            value={logs.length}
            icon={<IconClipboardText className="size-4" />}
          />
          <LogMetric
            label="Approved"
            value={logs.filter((log) => log.reviewStatus === "approved").length}
            icon={<IconShieldCheck className="size-4" />}
          />
          <LogMetric
            label="Owner visible"
            value={logs.filter((log) => log.isClientVisible).length}
            icon={<IconUsers className="size-4" />}
          />
          <LogMetric
            label="Photos"
            value={workspace.counts.totalPhotos}
            icon={<IconPhoto className="size-4" />}
          />
          <LogMetric
            label="Owner photos"
            value={workspace.counts.ownerVisiblePhotos}
            icon={<IconPhoto className="size-4" />}
          />
          <LogMetric
            label="Review queue"
            value={workspace.counts.photosAwaitingReview}
            icon={<IconShieldCheck className="size-4" />}
          />
        </div>

        {showNewLog && (
          <section className="border-y py-4">
            <form onSubmit={submitDailyLog} className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">New Daily Log</h2>
                  <p className="text-sm text-muted-foreground">
                    Saved logs enter review before owner visibility.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDraft(emptyDailyLogDraft())
                      setShowNewLog(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={isPending}>
                    Save daily log
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-y py-3">
                <div>
                  <p className="text-sm font-medium">Weather reference</p>
                  <p className="text-xs text-muted-foreground">
                    Uses the project address and selected log date.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isWeatherPending}
                  onClick={useProjectWeather}
                >
                  <IconCloud className="size-4" />
                  {isWeatherPending ? "Filling weather..." : "Fill weather"}
                </Button>
              </div>

              <DailyLogFields
                draft={draft}
                idPrefix="daily-log"
                updateDraft={updateDraft}
              />
            </form>
          </section>
        )}

        <section className="border-y py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search daily logs..."
                className="w-full sm:w-64"
                aria-label="Search daily logs"
              />
              <select
                value={filter}
                onChange={(event) => setFilter(filterValue(event.target.value))}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="all">All logs</option>
                <option value="needs_review">Needs review</option>
                <option value="approved">Approved</option>
                <option value="owner_visible">Owner visible</option>
              </select>
              <Input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="w-auto"
                aria-label="From date"
              />
              <Input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="w-auto"
                aria-label="To date"
              />
              <Button variant="outline" size="sm" onClick={selectVisibleLogs}>
                Select visible
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              {selectedIdsInView.length} selected · {filteredLogs.length} shown
            </div>
          </div>
          {message && (
            <p className="mt-3 border-l-2 border-l-[#3f7d4d] bg-muted/20 px-3 py-2 text-sm">
              {message}
            </p>
          )}
        </section>

        <div className="grid grid-cols-1 gap-2">
          {filteredLogs.map((log) => (
            <section
              key={log.id}
              id={`daily-log-${log.id}`}
              className="scroll-mt-24 border-y border-r border-l-2 border-l-[#3f7d4d] bg-background px-3 py-3 sm:px-4"
            >
              {(() => {
                const crewPresent = readableField(log.crewPresent)
                const materialsUsed = readableField(log.materialsUsed)

                return (
                  <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(log.id)}
                    onChange={() => toggleLog(log.id)}
                    className="mt-1 size-4 rounded border"
                    aria-label={`Select daily log for ${formatDate(log.logDate)}`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">
                        {formatDate(log.logDate)}
                      </h2>
                      <Badge variant="outline">
                        {sourceLabel(log.sourceSystem)}
                      </Badge>
                      <Badge
                        variant={
                          log.reviewStatus === "approved"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {statusLabel(log.reviewStatus)}
                      </Badge>
                      {log.isClientVisible && (
                        <Badge variant="outline">Owner visible</Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {log.authorName && <span>{log.authorName}</span>}
                      {log.weather && (
                        <>
                          {log.authorName && <span>&middot;</span>}
                          <span>{log.weather}</span>
                        </>
                      )}
                      {crewPresent && (
                        <>
                          <span>&middot;</span>
                          <span>{crewPresent}</span>
                        </>
                      )}
                      {log.hoursWorked !== null && (
                        <>
                          <span>&middot;</span>
                          <span>{log.hoursWorked} hours</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={editingLogId === log.id ? "secondary" : "outline"}
                    size="sm"
                    disabled={isPending}
                    onClick={() => startEditingLog(log)}
                  >
                    <IconPencil className="size-4" />
                    Edit
                  </Button>
                  <Button
                    variant={uploadingLogId === log.id ? "secondary" : "outline"}
                    size="sm"
                    disabled={isUploading}
                    onClick={() => startUploadingFiles(log)}
                  >
                    <IconUpload className="size-4" />
                    Add files
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      updateReview(log, "approved", log.isClientVisible)
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant={log.isClientVisible ? "default" : "outline"}
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      updateReview(
                        log,
                        log.reviewStatus === "draft"
                          ? "needs_review"
                          : log.reviewStatus,
                        !log.isClientVisible
                      )
                    }
                  >
                    {log.isClientVisible ? "Owner visible" : "Owner hidden"}
                  </Button>
                </div>
              </div>

              {editingLogId === log.id ? (
                <form
                  onSubmit={(event) => submitDailyLogEdit(event, log)}
                  className="mt-4 grid gap-4 border-t pt-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Edit Daily Log</h3>
                      <p className="text-xs text-muted-foreground">
                        Saving changes returns the log to review.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={cancelEditingLog}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={isPending}>
                        Save edits
                      </Button>
                    </div>
                  </div>
                  <DailyLogFields
                    draft={editDraft}
                    idPrefix={`daily-log-edit-${log.id}`}
                    updateDraft={updateEditDraft}
                  />
                </form>
              ) : (
                <>
                  <p className="mt-3 text-sm leading-6">{log.workCompleted}</p>

                  {(log.issues ||
                    materialsUsed ||
                    log.safetyIncidents ||
                    log.visitorLog ||
                    log.notes) && (
                    <dl className="mt-4 grid gap-x-5 gap-y-3 border-y py-3 md:grid-cols-2 xl:grid-cols-5">
                      {log.issues && (
                        <DailyLogDetail label="Issues">
                          {log.issues}
                        </DailyLogDetail>
                      )}
                      {materialsUsed && (
                        <DailyLogDetail label="Materials">
                          {materialsUsed}
                        </DailyLogDetail>
                      )}
                      {log.safetyIncidents && (
                        <DailyLogDetail label="Safety">
                          {log.safetyIncidents}
                        </DailyLogDetail>
                      )}
                      {log.visitorLog && (
                        <DailyLogDetail label="Visitors">
                          {log.visitorLog}
                        </DailyLogDetail>
                      )}
                      {log.notes && (
                        <DailyLogDetail label="Notes / Next" wide>
                          {log.notes}
                        </DailyLogDetail>
                      )}
                    </dl>
                  )}
                </>
              )}

              {uploadingLogId === log.id && (
                <div className="mt-4 border-t pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Add Photos or Documents
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Files save to Google Drive and stay attached to this log.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelUploadingFiles}
                      disabled={isUploading}
                    >
                      Cancel
                    </Button>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`daily-log-files-${log.id}`}>
                        Photos / documents
                      </Label>
                      <Input
                        key={uploadingLogId}
                        id={`daily-log-files-${log.id}`}
                        type="file"
                        multiple
                        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                        onChange={(event) =>
                          chooseUploadFiles(event.currentTarget.files)
                        }
                      />
                      {uploadFiles.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {uploadFiles.length} selected ·{" "}
                          {formatBytes(
                            uploadFiles.reduce(
                              (total, file) => total + file.size,
                              0
                            )
                          )}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`daily-log-file-caption-${log.id}`}>
                        Caption / note
                      </Label>
                      <Input
                        id={`daily-log-file-caption-${log.id}`}
                        value={uploadCaption}
                        onChange={(event) =>
                          setUploadCaption(event.currentTarget.value)
                        }
                        placeholder="Optional shared note for selected files"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        onClick={() => {
                          void uploadDailyLogFiles(log)
                        }}
                        disabled={isUploading || uploadFiles.length === 0}
                      >
                        <IconUpload className="size-4" />
                        {isUploading ? "Uploading..." : "Upload to Drive"}
                      </Button>
                    </div>
                  </div>

                  {uploadMessage && (
                    <p className="mt-3 border-l-2 border-l-[#3f7d4d] bg-muted/20 px-3 py-2 text-sm">
                      {uploadMessage}
                    </p>
                  )}
                </div>
              )}

              {log.tasks.length > 0 && (
                <div className="mt-3 border-y bg-muted/10 py-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <IconCalendarStats className="size-3.5" />
                    Schedule links
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {log.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="border-l-2 border-l-[#2f5963] bg-background px-3 py-2"
                      >
                        <p className="text-sm font-medium">{task.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(task.startDate)} - {formatDate(task.endDate)}
                          {" · "}
                          {statusLabel(task.status)}
                        </p>
                        {task.notes && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {task.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <PhotoStrip log={log} />
                  </>
                )
              })()}
            </section>
          ))}

          {filteredLogs.length === 0 && (
            <section className="border border-dashed p-6 text-sm text-muted-foreground">
              No daily logs match this filter yet.
            </section>
          )}
        </div>

        {workspace.unattachedPhotos.length > 0 && (
          <section className="border-y py-3 sm:py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Unattached Photos</h2>
                <p className="text-sm text-muted-foreground">
                  Photos are in the project library but are not tied to a daily
                  log yet.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/projects/${workspace.project.id}/photos`}>
                  <IconExternalLink className="size-4" />
                  Review photos
                </Link>
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {workspace.unattachedPhotos.slice(0, 16).map((photo) => (
                <div
                  key={photo.id}
                  className="relative aspect-[4/3] overflow-hidden rounded-md border bg-muted"
                >
                  <DailyLogPhotoThumb photo={photo} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
