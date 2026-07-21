"use client"

import * as React from "react"
import Link from "next/link"
import {
  CalendarDays,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cloud,
  CloudOff,
  Download,
  FileText,
  FolderOpen,
  HardHat,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Send,
  Settings,
  UploadCloud,
  X,
} from "lucide-react"
import { toast } from "sonner"

import {
  getFieldProjectPacket,
  getFieldDocumentFolder,
  submitFieldChatMessage,
  submitFieldDailyLog,
} from "@/app/actions/field-mode"
import { openProjectConversationChannel } from "@/app/actions/project-messages"
import { Button } from "@/components/ui/button"
import { DirectConversationLauncher } from "@/components/conversations/direct-conversation-launcher"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  addFieldOutboxItem,
  cacheFieldPacket,
  isFieldDocumentOffline,
  openFieldDocument,
  readCachedFieldPacket,
  readFieldOutbox,
  removeFieldOutboxItem,
  replaceFieldOutboxItem,
  saveFieldDocumentOffline,
} from "@/lib/field/offline-store"
import type {
  FieldDailyLogDraft,
  FieldDocument,
  FieldOutboxItem,
  FieldProject,
  FieldProjectPacket,
  FieldQueuedAttachment,
  FieldUserProfile,
} from "@/lib/field/types"
import {
  cacheNativeFieldProfile,
  addNativeFieldOutboxItem,
  cacheNativeFieldState,
  MAX_FIELD_ATTACHMENT_BYTES,
  openNativeFieldDocument,
  readNativeFieldDocuments,
  readNativeFieldOutbox,
  removeNativeFieldAttachment,
  removeNativeFieldOutboxItem,
  replaceNativeFieldOutboxItem,
  saveNativeFieldAttachments,
  saveNativeFieldDocument,
  uploadNativeFieldAttachment,
} from "@/lib/native/field-store"
import { isNative } from "@/lib/native/platform"

type FieldTab = "projects" | "today" | "log" | "documents" | "chat" | "notifications" | "settings"

const TABS: readonly {
  readonly value: FieldTab
  readonly label: string
  readonly icon: React.ComponentType<{ readonly className?: string }>
}[] = [
  { value: "projects", label: "Projects", icon: HardHat },
  { value: "today", label: "Today", icon: CalendarDays },
  { value: "log", label: "Log", icon: ClipboardList },
  { value: "documents", label: "Documents", icon: FolderOpen },
  { value: "chat", label: "Messages", icon: MessageSquare },
]

function todayIso(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function shortDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parsed)
}

function dateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

function fileSize(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function blankLog(): FieldDailyLogDraft {
  return {
    logDate: todayIso(),
    workCompleted: "",
    issues: "",
    crewPresent: "",
    notes: "",
  }
}

function EmptyState({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="border-y border-dashed py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function FieldNotificationsView({
  packet,
  online,
}: {
  readonly packet: FieldProjectPacket
  readonly online: boolean
}): React.ReactElement {
  if (packet.notifications.length === 0) {
    return <EmptyState>No notifications.</EmptyState>
  }

  return (
    <div>
      <div className="border-b pb-3">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Messages and project activity needing your attention.
        </p>
      </div>
      <div className="divide-y">
        {packet.notifications.map((notification) => {
          const content = (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{notification.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {notification.body}
                </p>
              </div>
              <span className="text-xs font-semibold text-primary">
                {notification.readAt ? "Open" : "New"}
              </span>
            </>
          )
          return online ? (
            <Link
              key={notification.id}
              href={`/api/field/notifications/${notification.id}/open`}
              className="flex items-start gap-3 py-4"
            >
              {content}
            </Link>
          ) : (
            <div key={notification.id} className="flex items-start gap-3 py-4">
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SyncStatus({ online, pending }: { readonly online: boolean; readonly pending: number }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      {online ? (
        <Cloud className="size-4 text-emerald-700" />
      ) : (
        <CloudOff className="size-4 text-amber-700" />
      )}
      <span>{online ? "Online" : "Offline"}</span>
      {pending > 0 ? (
        <span className="border-l pl-2 text-amber-800">
          {pending} waiting to sync
        </span>
      ) : null}
    </div>
  )
}

function SettingsView({
  profile,
  online,
  pending,
  selectedProject,
}: {
  readonly profile: FieldUserProfile
  readonly online: boolean
  readonly pending: number
  readonly selectedProject: FieldProject | null
}) {
  return (
    <div className="space-y-8">
      <section>
        <div className="border-b pb-3">
          <h2 className="text-lg font-semibold">Field settings</h2>
          <p className="text-sm text-muted-foreground">Profile and offline readiness</p>
        </div>
        <dl className="divide-y text-sm">
          <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{profile.name}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="min-w-0 break-all font-medium">{profile.email}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
            <dt className="text-muted-foreground">Role</dt>
            <dd className="font-medium">{profile.role}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
            <dt className="text-muted-foreground">Project</dt>
            <dd className="font-medium">{selectedProject?.name ?? "None selected"}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
            <dt className="text-muted-foreground">Sync</dt>
            <dd className="font-medium">
              {online ? "Online" : "Offline"} · {pending === 0 ? "Up to date" : `${pending} waiting`}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <div className="border-b pb-3">
          <h2 className="text-lg font-semibold">Before working offline</h2>
        </div>
        <ol className="list-decimal space-y-3 py-4 pl-5 text-sm leading-6">
          <li>While connected, open every project you expect to use.</li>
          <li>Refresh each project so tasks, schedule items, logs, and messages are current.</li>
          <li>In Documents, save the plans and files you need offline.</li>
          <li>Confirm the header says <strong>Up to date</strong> before leaving service.</li>
        </ol>
      </section>

      <section>
        <div className="border-b pb-3">
          <h2 className="text-lg font-semibold">How offline sync works</h2>
        </div>
        <div className="space-y-3 py-4 text-sm leading-6 text-muted-foreground">
          <p>Daily logs, attachments, and project messages are held securely on this device while offline.</p>
          <p>After service returns, keep Compass open until the waiting count reaches zero. Uploaded files are then stored in the project&apos;s Google Drive folder.</p>
          <p>If a file fails partway through, Compass keeps the remaining files for another attempt without creating a second daily log.</p>
        </div>
      </section>

      {online ? (
        <Button asChild variant="outline" className="w-full rounded-sm">
          <Link href="/dashboard/settings">Open full profile settings</Link>
        </Button>
      ) : null}
    </div>
  )
}

function ProjectList({
  projects,
  selectedId,
  loadingId,
  onSelect,
}: {
  readonly projects: readonly FieldProject[]
  readonly selectedId: string | null
  readonly loadingId: string | null
  readonly onSelect: (projectId: string) => void
}) {
  return (
    <div>
      <div className="border-b pb-3">
        <h2 className="text-lg font-semibold">Active projects</h2>
        <p className="text-sm text-muted-foreground">Choose the job you are working on.</p>
      </div>
      <div className="divide-y">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelect(project.id)}
            disabled={loadingId !== null}
            className={cn(
              "flex min-h-20 w-full items-center gap-3 px-1 py-4 text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selectedId === project.id && "border-l-4 border-primary pl-3"
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {project.projectNumber ? `${project.projectNumber} · ` : ""}
                {project.name}
              </p>
              {project.address ? (
                <p className="mt-1 truncate text-sm text-muted-foreground">{project.address}</p>
              ) : null}
            </div>
            {loadingId === project.id ? (
              <span className="flex items-center gap-2 text-xs font-semibold text-primary">
                <Loader2 className="size-4 animate-spin" /> Opening
              </span>
            ) : selectedId === project.id ? (
              <CheckCircle2 className="size-5 text-primary" aria-label="Selected project" />
            ) : (
              <ChevronRight className="size-5 text-muted-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function TodayView({ packet }: { readonly packet: FieldProjectPacket }) {
  const today = todayIso()
  const openTasks = packet.tasks.filter(
    (task) =>
      !["COMPLETE", "complete", "closed", "cancelled"].includes(task.status)
  )
  const assignedTasks = openTasks
    .filter((task) => task.kind === "task")
    .filter((task) => !task.endDate || task.endDate.slice(0, 10) >= today)
    .slice(0, 12)
  const currentSchedule = openTasks.filter(
    (task) =>
      task.kind === "schedule" &&
      task.startDate.slice(0, 10) <= today &&
      task.endDate.slice(0, 10) >= today
  )
  const upcomingTasks = openTasks
    .filter((task) => task.kind === "schedule")
    .filter((task) => task.startDate.slice(0, 10) > today)
    .slice(0, 12)

  return (
    <div className="space-y-7">
      <section>
        <div className="border-b pb-3">
          <h2 className="text-lg font-semibold">My tasks</h2>
          <p className="text-sm text-muted-foreground">Assigned work for this job.</p>
        </div>
        {assignedTasks.length === 0 ? (
          <EmptyState>No open tasks for this project.</EmptyState>
        ) : (
          <div className="divide-y">
            {assignedTasks.map((task) => (
              <div key={task.id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{task.title}</p>
                    {task.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                    ) : null}
                  </div>
                  {task.endDate ? (
                    <span className="shrink-0 text-sm font-semibold text-primary">
                      {shortDate(task.endDate)}
                    </span>
                  ) : null}
                </div>
                {task.assignedTo ? (
                  <p className="mt-2 text-sm">Assigned to {task.assignedTo}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="border-b pb-3">
          <h2 className="text-lg font-semibold">Today&apos;s schedule</h2>
          <p className="text-sm text-muted-foreground">Work currently underway.</p>
        </div>
        {currentSchedule.length === 0 ? (
          <EmptyState>No schedule items are active today.</EmptyState>
        ) : (
          <div className="divide-y">
            {currentSchedule.map((task) => (
              <div key={task.id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{task.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{task.phase}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-primary">
                    {task.percentComplete}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="border-b pb-3">
          <h2 className="text-lg font-semibold">Coming up</h2>
        </div>
        {upcomingTasks.length === 0 ? (
          <EmptyState>No upcoming schedule items.</EmptyState>
        ) : (
          <div className="divide-y">
            {upcomingTasks.map((task) => (
              <div key={task.id} className="grid grid-cols-[4.5rem_1fr] gap-3 py-4">
                <div className="text-sm font-semibold text-primary">{shortDate(task.startDate)}</div>
                <div>
                  <p className="font-medium">{task.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {task.phase} · through {shortDate(task.endDate)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

async function uploadBrowserDailyLogAttachments(input: {
  readonly projectId: string
  readonly dailyLogId: string
  readonly logDate: string
  readonly files: readonly File[]
}): Promise<void> {
  for (const file of input.files) {
    const formData = new FormData()
    formData.append("files", file)
    formData.set("dailyLogId", input.dailyLogId)
    formData.set("capturedDate", input.logDate)
    formData.set("photoKind", "progress")
    const response = await fetch(
      `/api/projects/${encodeURIComponent(input.projectId)}/photos/upload`,
      { method: "POST", body: formData }
    )
    const responseBody: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message =
        typeof responseBody === "object" &&
        responseBody !== null &&
        "error" in responseBody &&
        typeof responseBody.error === "string"
          ? responseBody.error
          : `Unable to upload ${file.name}.`
      throw new Error(message)
    }
  }
}

function DailyLogView({
  packet,
  online,
  onSubmitted,
  onPendingChange,
}: {
  readonly packet: FieldProjectPacket
  readonly online: boolean
  readonly onSubmitted: () => Promise<void>
  readonly onPendingChange: () => void
}) {
  const [draft, setDraft] = React.useState<FieldDailyLogDraft>(blankLog)
  const [submitting, setSubmitting] = React.useState(false)
  const [savingFiles, setSavingFiles] = React.useState(false)
  const [attachments, setAttachments] = React.useState<readonly FieldQueuedAttachment[]>([])
  const [browserFiles, setBrowserFiles] = React.useState<readonly File[]>([])

  async function chooseFiles(fileList: FileList | null): Promise<void> {
    if (fileList === null || fileList.length === 0) return
    const files = Array.from(fileList)
    const oversized = files.find((file) => file.size > MAX_FIELD_ATTACHMENT_BYTES)
    if (oversized) {
      toast.error(`${oversized.name} is larger than 50 MB.`)
      return
    }

    setSavingFiles(true)
    try {
      if (isNative()) {
        const saved = await saveNativeFieldAttachments(packet.project.id, files)
        setAttachments((current) => [...current, ...saved])
      } else {
        setBrowserFiles((current) => [...current, ...files])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the selected files.")
    } finally {
      setSavingFiles(false)
    }
  }

  async function removeAttachment(attachment: FieldQueuedAttachment): Promise<void> {
    await removeNativeFieldAttachment(attachment)
    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
  }

  async function submit(): Promise<void> {
    if (!draft.workCompleted.trim()) {
      toast.error("Add what was completed today.")
      return
    }

    setSubmitting(true)
    try {
      if (online) {
        const result = await submitFieldDailyLog(packet.project.id, draft)
        if (!result.success) throw new Error(result.error)
        if (isNative() && attachments.length > 0) {
          let remaining = [...attachments]
          try {
            for (const attachment of attachments) {
              await uploadNativeFieldAttachment({
                projectId: packet.project.id,
                dailyLogId: result.dailyLogId,
                logDate: draft.logDate,
                attachment,
              })
              remaining = remaining.filter((item) => item.id !== attachment.id)
            }
          } catch (error) {
            const outboxItem: FieldOutboxItem = {
              id: crypto.randomUUID(),
              kind: "daily_log",
              projectId: packet.project.id,
              createdAt: new Date().toISOString(),
              payload: draft,
              remoteDailyLogId: result.dailyLogId,
              attachments: remaining,
            }
            addFieldOutboxItem(outboxItem)
            await addNativeFieldOutboxItem(outboxItem)
            onPendingChange()
            toast.warning("Daily log saved. Remaining attachments will retry automatically.")
          }
        } else if (browserFiles.length > 0) {
          await uploadBrowserDailyLogAttachments({
            projectId: packet.project.id,
            dailyLogId: result.dailyLogId,
            logDate: draft.logDate,
            files: browserFiles,
          })
        }
        toast.success("Daily log submitted")
        setDraft(blankLog())
        setAttachments([])
        setBrowserFiles([])
        await onSubmitted()
        return
      }

      if (!isNative() && browserFiles.length > 0) {
        throw new Error("Files can only be saved offline in the HPS Compass app.")
      }

      const outboxItem: FieldOutboxItem = {
        id: crypto.randomUUID(),
        kind: "daily_log",
        projectId: packet.project.id,
        createdAt: new Date().toISOString(),
        payload: draft,
        remoteDailyLogId: null,
        attachments: [...attachments],
      }
      addFieldOutboxItem(outboxItem)
      await addNativeFieldOutboxItem(outboxItem)
      setDraft(blankLog())
      setAttachments([])
      setBrowserFiles([])
      onPendingChange()
      toast.success("Saved offline. It will sync automatically.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the daily log.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="border-b pb-3">
          <h2 className="text-lg font-semibold">Add daily log</h2>
          <p className="text-sm text-muted-foreground">Capture the day before leaving the job.</p>
        </div>
        <div className="space-y-5 py-5">
          <label className="block space-y-2 text-sm font-medium">
            Date
            <Input
              type="date"
              value={draft.logDate}
              onChange={(event) => setDraft({ ...draft, logDate: event.target.value })}
              className="h-12 rounded-sm"
            />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            What did we complete? <span className="text-destructive">*</span>
            <Textarea
              value={draft.workCompleted}
              onChange={(event) => setDraft({ ...draft, workCompleted: event.target.value })}
              placeholder="Describe today’s work"
              className="min-h-28 rounded-sm"
            />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            Who was on site?
            <Input
              value={draft.crewPresent}
              onChange={(event) => setDraft({ ...draft, crewPresent: event.target.value })}
              placeholder="Crew, subs, suppliers"
              className="h-12 rounded-sm"
            />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            Issues or delays
            <Textarea
              value={draft.issues}
              onChange={(event) => setDraft({ ...draft, issues: event.target.value })}
              placeholder="Leave blank if none"
              className="min-h-20 rounded-sm"
            />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            Notes
            <Textarea
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              className="min-h-20 rounded-sm"
            />
          </label>
          <div className="border-y py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Attachments</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Photos, short videos, PDFs, or project documents up to 50 MB each.
                </p>
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 border border-primary px-3 text-sm font-semibold text-primary">
                {savingFiles ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                Add files
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  className="sr-only"
                  disabled={savingFiles}
                  onChange={(event) => {
                    void chooseFiles(event.currentTarget.files)
                    event.currentTarget.value = ""
                  }}
                />
              </label>
            </div>
            {attachments.length > 0 || browserFiles.length > 0 ? (
              <div className="mt-3 divide-y border-y">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex items-center gap-3 py-3">
                    <Paperclip className="size-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                      <p className="text-xs text-muted-foreground">{fileSize(attachment.fileSize)} · saved on device</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${attachment.fileName}`} onClick={() => void removeAttachment(attachment)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {browserFiles.map((file) => (
                  <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-3 py-3">
                    <Paperclip className="size-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{fileSize(file.size)}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${file.name}`} onClick={() => setBrowserFiles((current) => current.filter((item) => item !== file))}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <Button type="button" size="lg" className="h-13 w-full text-base" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : online ? <UploadCloud /> : <CloudOff />}
            {online ? "Submit daily log" : "Save for sync"}
          </Button>
        </div>
      </section>

      <section>
        <div className="border-b pb-3">
          <h2 className="text-lg font-semibold">Recent logs</h2>
        </div>
        <div className="divide-y">
          {packet.logs.slice(0, 8).map((log) => (
            <div key={log.id} className="py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{shortDate(log.logDate)}</p>
                <span className="text-xs text-muted-foreground">{log.authorName}</span>
              </div>
              <p className="mt-2 text-sm leading-6">{log.workCompleted}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function DocumentsView({
  packet,
  online,
  initialDownloadFileId,
  initialFolderId,
}: {
  readonly packet: FieldProjectPacket
  readonly online: boolean
  readonly initialDownloadFileId: string | null
  readonly initialFolderId: string | null
}) {
  type DocumentListing = {
    readonly id: string | null
    readonly name: string
    readonly documents: readonly FieldDocument[]
  }

  const [offlineIds, setOfflineIds] = React.useState<ReadonlySet<string>>(new Set())
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [folderStack, setFolderStack] = React.useState<readonly DocumentListing[]>([
    { id: null, name: "Documents", documents: packet.documents },
  ])
  const automaticDownloadRef = React.useRef<string | null>(null)
  const currentListing = folderStack[folderStack.length - 1] ?? {
    id: null,
    name: "Documents",
    documents: packet.documents,
  }

  React.useEffect(() => {
    setFolderStack([{ id: null, name: "Documents", documents: packet.documents }])
  }, [packet.documents, packet.project.id])

  React.useEffect(() => {
    let active = true
    const savedPromise = isNative()
      ? readNativeFieldDocuments().then((documents) =>
          documents
            .filter((document) => document.projectId === packet.project.id)
            .map((document) => ({ id: document.fileId, saved: true }))
        )
      : Promise.all(
          currentListing.documents
            .filter((document) => document.type !== "folder")
            .map(async (document) => ({
              id: document.id,
              saved: await isFieldDocumentOffline(packet.project.id, document.id),
            }))
        )
    savedPromise.then((results) => {
      if (active) {
        setOfflineIds(
          new Set(results.filter((result) => result.saved).map((result) => result.id))
        )
      }
    })
    return () => {
      active = false
    }
  }, [currentListing.documents, packet.project.id])

  async function browseFolder(folderId: string): Promise<void> {
    if (!online) {
      toast.error("Connect to browse this folder. Files already downloaded remain available offline.")
      return
    }

    setBusyId(folderId)
    try {
      const result = await getFieldDocumentFolder(packet.project.id, folderId)
      if (!result.success) throw new Error(result.error)
      setFolderStack((current) => [
        ...current,
        {
          id: result.folder.id,
          name: result.folder.name,
          documents: result.documents,
        },
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open the folder.")
    } finally {
      setBusyId(null)
    }
  }

  async function save(
    fileId: string,
    name: string,
    openAfterSave = false
  ): Promise<void> {
    setBusyId(fileId)
    try {
      if (isNative()) {
        await saveNativeFieldDocument({
          projectId: packet.project.id,
          fileId,
          name,
        })
      } else {
        await saveFieldDocumentOffline(packet.project.id, fileId)
      }
      setOfflineIds((current) => new Set([...current, fileId]))
      toast.success("Document available offline")
      if (openAfterSave) await open(fileId, null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the document.")
    } finally {
      setBusyId(null)
    }
  }

  async function open(fileId: string, webViewLink: string | null): Promise<void> {
    try {
      if (isNative()) {
        const opened = await openNativeFieldDocument(packet.project.id, fileId)
        if (opened) return
      }
      await openFieldDocument(packet.project.id, fileId, online ? webViewLink : null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open the document.")
    }
  }

  React.useEffect(() => {
    if (!online || !initialDownloadFileId) return
    const document = currentListing.documents.find(
      (item) => item.id === initialDownloadFileId && item.type !== "folder"
    )
    if (!document) return
    const downloadKey = `${packet.project.id}:${document.id}`
    if (automaticDownloadRef.current === downloadKey) return
    automaticDownloadRef.current = downloadKey
    void save(document.id, document.name, true)
  }, [currentListing.documents, initialDownloadFileId, online, packet.project.id])

  React.useEffect(() => {
    if (!online || !initialFolderId) return
    const folderKey = `${packet.project.id}:${initialFolderId}`
    if (automaticDownloadRef.current === folderKey) return
    automaticDownloadRef.current = folderKey
    void browseFolder(initialFolderId)
  }, [initialFolderId, online, packet.project.id])

  return (
    <div>
      <div className="border-b pb-3">
        <div className="flex items-center gap-2">
          {folderStack.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Back to previous folder"
              onClick={() => setFolderStack((current) => current.slice(0, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
          ) : null}
          <h2 className="truncate text-lg font-semibold">{currentListing.name}</h2>
        </div>
        <p className="text-sm text-muted-foreground">Download the files you need before heading to the site.</p>
      </div>
      {currentListing.documents.length === 0 ? (
        <EmptyState>This folder is empty.</EmptyState>
      ) : (
        <div className="divide-y">
          {currentListing.documents.map((document) => {
            const saved = offlineIds.has(document.id)
            return (
              <div key={document.id} className="flex min-h-20 items-center gap-3 py-3">
                {document.type === "folder" ? <FolderOpen className="size-5 text-primary" /> : <FileText className="size-5 text-primary" />}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => document.type === "folder"
                    ? void browseFolder(document.id)
                    : void open(document.id, document.webViewLink)}
                  disabled={busyId === document.id}
                >
                  <p className="truncate font-medium">{document.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {busyId === document.id
                      ? "Opening..."
                      : saved
                        ? "Available offline"
                        : document.type === "folder"
                          ? online ? "Browse folder" : "Connect to browse"
                          : "Online only"}
                  </p>
                </button>
                {document.type !== "folder" && online && !saved ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Save ${document.name} offline`} onClick={() => save(document.id, document.name)} disabled={busyId === document.id}>
                    {busyId === document.id ? <Loader2 className="animate-spin" /> : <Download />}
                  </Button>
                ) : saved ? (
                  <CheckCircle2 className="size-5 text-emerald-700" aria-label="Available offline" />
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MessagesView({
  packet,
  online,
  onSubmitted,
  onPendingChange,
}: {
  readonly packet: FieldProjectPacket
  readonly online: boolean
  readonly onSubmitted: () => Promise<void>
  readonly onPendingChange: () => void
}) {
  const [content, setContent] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [startingChannel, setStartingChannel] = React.useState(false)
  const [composerFocused, setComposerFocused] = React.useState(false)
  const [activeChannelId, setActiveChannelId] = React.useState<string | null>(
    packet.channel?.id ?? packet.directConversations[0]?.id ?? null
  )

  const activeDirectConversation = packet.directConversations.find(
    (conversation) => conversation.id === activeChannelId
  ) ?? null
  const projectChannelActive = packet.channel?.id === activeChannelId
  const activeMessages = projectChannelActive
    ? packet.messages
    : activeDirectConversation?.messages ?? []
  const activeChannelName = projectChannelActive
    ? packet.channel?.name ?? "Project messages"
    : activeDirectConversation?.name ?? null

  React.useEffect(() => {
    const channelStillExists =
      packet.channel?.id === activeChannelId ||
      packet.directConversations.some(
        (conversation) => conversation.id === activeChannelId
      )
    if (channelStillExists) return
    setActiveChannelId(packet.channel?.id ?? packet.directConversations[0]?.id ?? null)
  }, [activeChannelId, packet.channel?.id, packet.directConversations])

  async function startProjectChannel(): Promise<void> {
    if (!online || startingChannel) return
    setStartingChannel(true)
    try {
      const result = await openProjectConversationChannel(packet.project.id)
      if (!result.success) throw new Error(result.error)
      setActiveChannelId(result.data.channelId)
      await onSubmitted()
      toast.success(result.data.created ? "Project channel created" : "Project channel opened")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start the project channel.")
    } finally {
      setStartingChannel(false)
    }
  }

  async function send(): Promise<void> {
    const message = content.trim()
    if (!activeChannelId || !message) return
    setSending(true)
    try {
      if (online) {
        const result = await submitFieldChatMessage(activeChannelId, message)
        if (!result.success) throw new Error(result.error)
        setContent("")
        await onSubmitted()
        return
      }

      const outboxItem: FieldOutboxItem = {
        id: crypto.randomUUID(),
        kind: "chat_message",
        projectId: packet.project.id,
        createdAt: new Date().toISOString(),
        payload: { channelId: activeChannelId, content: message },
      }
      addFieldOutboxItem(outboxItem)
      await addNativeFieldOutboxItem(outboxItem)
      setContent("")
      onPendingChange()
      toast.success("Message saved. It will send when you reconnect.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send the message.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-15rem)] flex-col">
      <div className="border-b pb-4">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {packet.channel ? (
            <Button
              type="button"
              variant={projectChannelActive ? "default" : "outline"}
              size="sm"
              className="shrink-0"
              onClick={() => setActiveChannelId(packet.channel?.id ?? null)}
            >
              <MessageSquare />
              Project team
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!online || startingChannel}
              onClick={() => void startProjectChannel()}
            >
              {startingChannel ? <Loader2 className="animate-spin" /> : <MessageSquare />}
              {startingChannel ? "Starting..." : "Start project channel"}
            </Button>
          )}
          {packet.directConversations.map((conversation) => (
            <Button
              key={conversation.id}
              type="button"
              variant={activeChannelId === conversation.id ? "default" : "outline"}
              size="sm"
              className="shrink-0"
              onClick={() => setActiveChannelId(conversation.id)}
            >
              {conversation.name}
              {conversation.unreadCount > 0 ? ` (${conversation.unreadCount})` : ""}
            </Button>
          ))}
        </div>
        {online ? (
          <DirectConversationLauncher
            staffOnly
            onConversationOpened={async (channelId) => {
              setActiveChannelId(channelId)
              await onSubmitted()
            }}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Cached conversations can be opened and replied to while offline.
          </p>
        )}
      </div>

      {activeChannelName ? (
        <div className="border-b py-3">
          <h2 className="text-lg font-semibold">{activeChannelName}</h2>
          <p className="text-sm text-muted-foreground">
            {projectChannelActive ? "Project messages" : "Direct conversation"}
          </p>
        </div>
      ) : null}

      <div className="flex-1 divide-y py-2">
        {!activeChannelName ? (
          <EmptyState>Start a project channel or direct conversation.</EmptyState>
        ) : activeMessages.length === 0 ? (
          <EmptyState>No messages yet.</EmptyState>
        ) : (
          activeMessages.map((message) => (
            <div key={message.id} className="py-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="font-semibold">{message.userName}</p>
                <time className="text-xs text-muted-foreground">{dateTime(message.createdAt)}</time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
            </div>
          ))
        )}
      </div>
      {activeChannelId ? <div
        className={cn(
          "border-t bg-background py-3",
          composerFocused
            ? "fixed inset-x-4 bottom-0 z-50 shadow-[0_-12px_22px_rgba(0,0,0,0.12)]"
            : "sticky bottom-[4.5rem]"
        )}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onFocus={(event) => {
              setComposerFocused(true)
              const input = event.currentTarget
              window.setTimeout(
                () => input.scrollIntoView({ behavior: "smooth", block: "center" }),
                250
              )
            }}
            onBlur={() => setComposerFocused(false)}
            placeholder={projectChannelActive ? "Message the project team" : "Reply privately"}
            className="min-h-12 resize-none rounded-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <Button type="button" size="icon" className="size-12 shrink-0" aria-label="Send message" onClick={send} disabled={sending || !content.trim()}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Shift + Enter for a new line</p>
      </div> : null}
    </div>
  )
}

export function FieldModeWorkspace({
  userId,
  profile,
  projects,
  initialPacket,
  initialTab = "today",
  initialDownloadFileId = null,
  initialFolderId = null,
  restoreStoredProject = true,
}: {
  readonly userId: string
  readonly profile: FieldUserProfile
  readonly projects: readonly FieldProject[]
  readonly initialPacket: FieldProjectPacket | null
  readonly initialTab?: FieldTab
  readonly initialDownloadFileId?: string | null
  readonly initialFolderId?: string | null
  readonly restoreStoredProject?: boolean
}) {
  const [tab, setTab] = React.useState<FieldTab>(initialTab)
  const [packet, setPacket] = React.useState(initialPacket)
  const [online, setOnline] = React.useState(true)
  const [loadingProjectId, setLoadingProjectId] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(0)
  const flushing = React.useRef(false)
  const loadingProjectRef = React.useRef<string | null>(null)
  const packetRef = React.useRef(packet)

  React.useEffect(() => {
    packetRef.current = packet
  }, [packet])

  const updatePending = React.useCallback(async (): Promise<void> => {
    const nativeItems = await readNativeFieldOutbox()
    const ids = new Set([
      ...readFieldOutbox().map((item) => item.id),
      ...nativeItems.map((item) => item.id),
    ])
    setPending(ids.size)
  }, [])

  const loadProject = React.useCallback(
    async (projectId: string): Promise<void> => {
      if (loadingProjectRef.current !== null) return
      loadingProjectRef.current = projectId
      setLoadingProjectId(projectId)
      try {
        if (!navigator.onLine) {
          const cached = readCachedFieldPacket(userId, projectId)
          if (!cached) throw new Error("Open this project online once before using it offline.")
          setPacket(cached)
          setTab("today")
          return
        }
        const nextPacket = await getFieldProjectPacket(projectId)
        cacheFieldPacket(userId, nextPacket)
        await cacheNativeFieldState(projects, nextPacket)
        window.localStorage.setItem("compass.activeProjectId", projectId)
        setPacket(nextPacket)
        setTab("today")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to open the project.")
      } finally {
        loadingProjectRef.current = null
        setLoadingProjectId(null)
      }
    },
    [projects, userId]
  )

  React.useEffect(() => {
    if (!restoreStoredProject) return
    const storedProjectId = window.localStorage.getItem("compass.activeProjectId")
    if (
      storedProjectId &&
      storedProjectId !== initialPacket?.project.id &&
      projects.some((project) => project.id === storedProjectId)
    ) {
      void loadProject(storedProjectId)
    }
  }, [initialPacket?.project.id, loadProject, projects, restoreStoredProject])

  const refreshProject = React.useCallback(async (projectId: string): Promise<void> => {
    if (!navigator.onLine) return
    const nextPacket = await getFieldProjectPacket(projectId)
    cacheFieldPacket(userId, nextPacket)
    await cacheNativeFieldState(projects, nextPacket)
    setPacket(nextPacket)
  }, [projects, userId])

  const refresh = React.useCallback(async (): Promise<void> => {
    const current = packetRef.current
    if (!current) return
    await refreshProject(current.project.id)
  }, [refreshProject])

  const flushOutbox = React.useCallback(async (): Promise<void> => {
    if (flushing.current || !navigator.onLine) return
    flushing.current = true
    try {
      const webItems = readFieldOutbox()
      const nativeItems = await readNativeFieldOutbox()
      const queuedItems = [...webItems]
      for (const nativeItem of nativeItems) {
        if (!queuedItems.some((item) => item.id === nativeItem.id)) {
          queuedItems.push(nativeItem)
        }
      }

      for (const item of queuedItems) {
        try {
          if (item.kind === "daily_log") {
            let remoteDailyLogId = item.remoteDailyLogId
            let remainingAttachments = [...item.attachments]
            if (!remoteDailyLogId) {
              const result = await submitFieldDailyLog(item.projectId, item.payload)
              if (!result.success) break
              remoteDailyLogId = result.dailyLogId
              const updatedItem: FieldOutboxItem = {
                ...item,
                remoteDailyLogId,
                attachments: remainingAttachments,
              }
              replaceFieldOutboxItem(updatedItem)
              await replaceNativeFieldOutboxItem(updatedItem)
            }

            for (const attachment of remainingAttachments) {
              await uploadNativeFieldAttachment({
                projectId: item.projectId,
                dailyLogId: remoteDailyLogId,
                logDate: item.payload.logDate,
                attachment,
              })
              remainingAttachments = remainingAttachments.filter(
                (queuedAttachment) => queuedAttachment.id !== attachment.id
              )
              const updatedItem: FieldOutboxItem = {
                ...item,
                remoteDailyLogId,
                attachments: remainingAttachments,
              }
              replaceFieldOutboxItem(updatedItem)
              await replaceNativeFieldOutboxItem(updatedItem)
            }
          } else {
            const result = await submitFieldChatMessage(
              item.payload.channelId,
              item.payload.content
            )
            if (!result.success) break
          }
          removeFieldOutboxItem(item.id)
          await removeNativeFieldOutboxItem(item.id)
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "A queued item could not be synchronized."
          )
          break
        }
      }
      await updatePending()
      const current = packetRef.current
      if (current) await refreshProject(current.project.id)
    } finally {
      flushing.current = false
    }
  }, [refreshProject, updatePending])

  React.useEffect(() => {
    if (initialPacket) {
      cacheFieldPacket(userId, initialPacket)
      void cacheNativeFieldState(projects, initialPacket)
    }
    void cacheNativeFieldProfile(profile)
    setOnline(navigator.onLine)
    void updatePending()
    const handleOnline = () => {
      setOnline(true)
      void flushOutbox()
    }
    const handleOffline = () => setOnline(false)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    if (navigator.onLine) void flushOutbox()
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [flushOutbox, initialPacket, profile, projects, updatePending, userId])

  const fullCompassHref = packet
    ? `/dashboard/projects/${packet.project.id}`
    : "/dashboard/projects"
  const unreadNotifications = packet?.notifications.filter(
    (notification) => notification.readAt === null
  ).length ?? 0

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden bg-background">
      <header className="z-20 shrink-0 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-primary">Field mode</p>
            <h1 className="truncate text-base font-semibold">
              {packet ? `${packet.project.projectNumber ? `${packet.project.projectNumber} · ` : ""}${packet.project.name}` : "Compass"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="relative grid size-9 place-items-center text-muted-foreground hover:text-foreground"
              aria-label="Notifications"
              onClick={() => setTab("notifications")}
            >
              <Bell className="size-5" />
              {unreadNotifications > 0 ? (
                <span className="absolute right-0 top-0 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="grid size-9 place-items-center text-muted-foreground hover:text-foreground"
              aria-label="Field settings"
              onClick={() => setTab("settings")}
            >
              <Settings className="size-5" />
            </button>
            <Link href={fullCompassHref} className="text-sm font-semibold text-primary hover:underline">
              Full Compass
            </Link>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <SyncStatus online={online} pending={pending} />
          {packet && online ? (
            <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Refresh field data" onClick={() => void refresh()}>
              <RefreshCw className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-5">
        {tab === "settings" ? (
          <SettingsView profile={profile} online={online} pending={pending} selectedProject={packet?.project ?? null} />
        ) : tab === "notifications" && packet ? (
          <FieldNotificationsView packet={packet} online={online} />
        ) : tab === "projects" ? (
          <ProjectList projects={projects} selectedId={packet?.project.id ?? null} loadingId={loadingProjectId} onSelect={(projectId) => void loadProject(projectId)} />
        ) : !packet ? (
          <EmptyState>Select an active project to begin.</EmptyState>
        ) : tab === "today" ? (
          <TodayView packet={packet} />
        ) : tab === "log" ? (
          <DailyLogView packet={packet} online={online} onSubmitted={refresh} onPendingChange={() => void updatePending()} />
        ) : tab === "documents" ? (
          <DocumentsView
            packet={packet}
            online={online}
            initialDownloadFileId={initialDownloadFileId}
            initialFolderId={initialFolderId}
          />
        ) : (
          <MessagesView packet={packet} online={online} onSubmitted={refresh} onPendingChange={() => void updatePending()} />
        )}
      </main>

      <nav className="z-30 shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid h-16 max-w-3xl grid-cols-5">
          {TABS.map((item) => {
            const Icon = item.icon
            const active = tab === item.value
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setTab(item.value)}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="size-5" />
                <span className="max-w-full truncate px-1">{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
