"use client"

import * as React from "react"
import {
  IconCalendarStats,
  IconClipboardText,
  IconPencil,
  IconUpload,
} from "@tabler/icons-react"

import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type { DailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { PhotoStrip } from "@/components/projects/daily-log/daily-log-photo-strip"
import { SavedLogLines } from "@/components/projects/daily-log/saved-log-lines"
import {
  dailyLogTodoDescription,
  readableField,
  sourceLabel,
  statusLabel,
} from "@/lib/daily-logs/workspace-view"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

type DailyLogCardProps = {
  readonly log: ProjectDailyLogItem
  readonly projectId: string
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly savedLogRules: DailyLogFollowUpSetup["rules"] | null
  readonly developerModeEnabled: boolean
  readonly selected: boolean
  readonly onToggleSelected: () => void
  readonly isPending: boolean
  readonly isUploading: boolean
  readonly editing: boolean
  readonly uploadingFiles: boolean
  readonly onEdit: () => void
  readonly onAddFiles: () => void
  readonly onReview: (reviewStatus: string, isClientVisible: boolean) => void
  /** The edit form, shown in place of the saved details while editing. */
  readonly editForm: React.ReactNode
  /** The Add files panel, while it is open for this log. */
  readonly uploadPanel: React.ReactNode
}

/** One saved daily log: header and actions, details, to-dos, schedule links and photos. */
export function DailyLogCard(props: DailyLogCardProps): React.ReactElement {
  const { log, editing, editForm, uploadPanel, projectId } = props
  return (
    <section
      id={`daily-log-${log.id}`}
      className="scroll-mt-6 rounded-lg border p-3 sm:p-4"
    >
      <DailyLogCardHeader {...props} />

      {editing ? (
        editForm
      ) : (
        <DailyLogSavedDetails
          log={log}
          projectId={projectId}
          rules={props.savedLogRules}
          assigneeOptions={props.assigneeOptions}
        />
      )}

      {uploadPanel}

      {log.todos.length > 0 && (
        <div className="mt-3 rounded-md border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <IconClipboardText className="size-3.5" />
            To-dos
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {log.todos.map((todo) => (
              <div key={todo.id} className="rounded-md bg-background p-2">
                <p className="text-sm font-medium">{todo.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {statusLabel(todo.status)}
                  {todo.dueDate
                    ? ` · Due ${formatDate(todo.dueDate)}`
                    : ""}
                  {todo.assigneeName || todo.companyName
                    ? ` · ${todo.assigneeName ?? todo.companyName}`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {log.scheduleItems.length > 0 && (
        <div className="mt-3 rounded-md border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <IconCalendarStats className="size-3.5" />
            Schedule links
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {log.scheduleItems.map((item) => (
              <div key={item.id} className="rounded-md bg-background p-2">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(item.startDate)} - {formatDate(item.endDate)}
                  {" · "}
                  {statusLabel(item.status)}
                </p>
                {item.notes && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <PhotoStrip log={log} projectId={projectId} />
    </section>
  )
}

function DailyLogCardHeader({
  log,
  projectId,
  assigneeOptions,
  developerModeEnabled,
  selected,
  onToggleSelected,
  isPending,
  isUploading,
  editing,
  uploadingFiles,
  onEdit,
  onAddFiles,
  onReview,
}: DailyLogCardProps): React.ReactElement {
  const crewPresent = readableField(log.crewPresent)
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          className="mt-1 size-4 rounded border"
          aria-label={`Select daily log for ${formatDate(log.logDate)}`}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">
              {formatDate(log.logDate)}
            </h2>
            {developerModeEnabled && (
              <Badge variant="outline">
                {sourceLabel(log.sourceSystem)}
              </Badge>
            )}
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
        <ProjectTaskCreateButton
          projectId={projectId}
          sourceLabel="Daily log"
          sourceRecordId={log.id}
          sourceRecordNumber={
            log.sourceExternalId ?? formatDate(log.logDate)
          }
          sourceHref={`/dashboard/projects/${projectId}/daily-logs#daily-log-${log.id}`}
          defaultTitle={`Follow up from ${formatDate(log.logDate)}`}
          defaultDescription={dailyLogTodoDescription(log)}
          defaultAssigneeName={null}
          defaultCompanyName={null}
          defaultDueDate={null}
          defaultPriority={
            log.issues || log.safetyIncidents ? "high" : "normal"
          }
          assigneeOptions={assigneeOptions}
        />
        <Button
          variant={editing ? "secondary" : "outline"}
          size="sm"
          disabled={isPending}
          onClick={onEdit}
        >
          <IconPencil className="size-4" />
          Edit
        </Button>
        <Button
          variant={uploadingFiles ? "secondary" : "outline"}
          size="sm"
          disabled={isUploading}
          onClick={onAddFiles}
        >
          <IconUpload className="size-4" />
          Add files
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            onReview("approved", log.isClientVisible)
          }
        >
          Approve
        </Button>
        <Button
          variant={log.isClientVisible ? "default" : "outline"}
          size="sm"
          disabled={isPending}
          onClick={() =>
            onReview(
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
  )
}

/** The saved log's text, cost code lines and details. */
function DailyLogSavedDetails({
  log,
  projectId,
  rules,
  assigneeOptions,
}: {
  readonly log: ProjectDailyLogItem
  readonly projectId: string
  readonly rules: DailyLogFollowUpSetup["rules"] | null
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
}): React.ReactElement {
  const materialsUsed = readableField(log.materialsUsed)
  const hasSupplementalDetails = Boolean(
    log.issues ||
      materialsUsed ||
      log.safetyIncidents ||
      log.visitorLog
  )
  return (
    <>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
        {log.workCompleted}
      </p>
      {log.workLines.length > 0 && (
        <ul className="mt-3 grid gap-1 border-y py-2 text-sm" aria-label="Cost codes and time">
          {log.workLines.map((line) => (
            <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
              <span className="min-w-0">
                <span className="font-medium">{line.costCode}</span>{" "}
                {line.costCodeLabel}
                {line.description && (
                  <span className="text-muted-foreground"> — {line.description}</span>
                )}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {line.hours === null ? "—" : `${line.hours} h`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(log.issues ||
        materialsUsed ||
        log.safetyIncidents ||
        log.visitorLog ||
        log.notes) && (
        <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-4 border-t pt-4 text-sm md:grid-cols-2 xl:grid-cols-4">
          {log.issues && (
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                Issues
              </dt>
              <SavedLogLines
                log={log}
                source="issues"
                text={log.issues}
                projectId={projectId}
                rules={rules}
                assigneeOptions={assigneeOptions}
              />
            </div>
          )}
          {materialsUsed && (
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                Materials
              </dt>
              <dd className="mt-1 whitespace-pre-wrap break-words leading-6">
                {materialsUsed}
              </dd>
            </div>
          )}
          {log.safetyIncidents && (
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                Safety
              </dt>
              <dd className="mt-1 whitespace-pre-wrap break-words leading-6">
                {log.safetyIncidents}
              </dd>
            </div>
          )}
          {log.visitorLog && (
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                Visitors
              </dt>
              <dd className="mt-1 whitespace-pre-wrap break-words leading-6">
                {log.visitorLog}
              </dd>
            </div>
          )}
          {log.notes && (
            <div
              className={cn(
                "min-w-0 md:col-span-2 xl:col-span-4",
                hasSupplementalDetails && "border-t pt-4"
              )}
            >
              <dt className="text-xs font-medium uppercase text-muted-foreground">
                Notes / Next
              </dt>
              <SavedLogLines
                log={log}
                source="notes"
                text={log.notes}
                projectId={projectId}
                rules={rules}
                assigneeOptions={assigneeOptions}
              />
            </div>
          )}
        </dl>
      )}
    </>
  )
}
