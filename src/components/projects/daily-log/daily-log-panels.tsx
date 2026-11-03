"use client"

import * as React from "react"
import Link from "next/link"
import {
  IconCheck,
  IconClipboardText,
  IconExternalLink,
  IconEye,
  IconMailForward,
  IconPhoto,
  IconPlus,
  IconPrinter,
  IconShieldCheck,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react"

import type {
  ProjectDailyLogItem,
  ProjectDailyLogWorkspace,
} from "@/lib/domain/field/daily-log-workspace"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { PageHeader } from "@/components/page-header"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { DailyLogPhotoThumb } from "@/components/projects/daily-log/daily-log-photo-strip"
import {
  ALL_DAILY_LOG_AUTHORS,
  UNKNOWN_DAILY_LOG_AUTHOR,
} from "@/lib/daily-logs/print-selection"
import { filterValue, type LogFilter } from "@/lib/daily-logs/workspace-view"
import { formatDate } from "@/lib/format"

/** Confirms deleting one log (from its edit form) or the selected logs. */
export function DailyLogDeleteDialog({
  pendingDeleteIds,
  pendingDeleteLogs,
  isPending,
  onCancel,
  onConfirm,
}: {
  readonly pendingDeleteIds: readonly string[]
  readonly pendingDeleteLogs: readonly ProjectDailyLogItem[]
  readonly isPending: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}): React.ReactElement {
  return (
    <AlertDialog
      open={pendingDeleteIds.length > 0}
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingDeleteLogs.length === 1
              ? `Delete the ${formatDate(pendingDeleteLogs[0]?.logDate ?? "")} daily log?`
              : `Delete ${pendingDeleteLogs.length} daily logs?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The log entries are removed from this project. Photos and files
            attached to them stay in the project&apos;s photos, and a copy of each
            log is kept in the activity log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {pendingDeleteLogs.length === 1 ? "Delete log" : `Delete ${pendingDeleteLogs.length} logs`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The page header with the New daily log, Photo review, Print and Draft owner update actions. */
export function DailyLogPageHeader({
  project,
  projectLabel,
  showNewLog,
  onToggleNewLog,
  savedButton,
  showPrintOptions,
  onTogglePrintOptions,
  onDraftOwnerUpdate,
  draftDisabled,
}: {
  readonly project: ProjectDailyLogWorkspace["project"]
  readonly projectLabel: string
  readonly showNewLog: boolean
  readonly onToggleNewLog: () => void
  readonly savedButton: "new" | "edit" | null
  readonly showPrintOptions: boolean
  readonly onTogglePrintOptions: () => void
  readonly onDraftOwnerUpdate: () => void
  readonly draftDisabled: boolean
}): React.ReactElement {
  return (
    <PageHeader
      className="mb-0"
      back={{ href: `/dashboard/projects/${project.id}`, label: "Project" }}
      eyebrow={`${projectLabel}${project.clientName ? ` · ${project.clientName}` : ""}`}
      title="Daily Logs"
      actions={
        <>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <ProjectContextSwitcher
              currentProjectId={project.id}
              targetSection="daily-logs"
              placeholder="Switch daily log project..."
              className="w-full sm:w-[280px]"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant={showNewLog ? "secondary" : "default"}
                size="sm"
                onClick={onToggleNewLog}
              >
                {savedButton === null ? (
                  <>
                    <IconPlus className="size-4" />
                    New daily log
                  </>
                ) : (
                  <>
                    <IconCheck className="size-4" />
                    Saved
                  </>
                )}
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/projects/${project.id}/photos`}>
                  <IconPhoto className="size-4" />
                  Photo review
                </Link>
              </Button>
              <Button
                type="button"
                variant={showPrintOptions ? "secondary" : "outline"}
                size="sm"
                onClick={onTogglePrintOptions}
              >
                <IconPrinter className="size-4" />
                Print
              </Button>
              <Button
                size="sm"
                onClick={onDraftOwnerUpdate}
                disabled={draftDisabled}
              >
                <IconMailForward className="size-4" />
                Draft owner update
              </Button>
            </div>
          </div>
        </>
      }
    />
  )
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

/** Log and photo counts under the header. */
export function DailyLogMetrics({
  logs,
  counts,
}: {
  readonly logs: readonly ProjectDailyLogItem[]
  readonly counts: ProjectDailyLogWorkspace["counts"]
}): React.ReactElement {
  return (
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
        value={counts.totalPhotos}
        icon={<IconPhoto className="size-4" />}
      />
      <LogMetric
        label="Owner photos"
        value={counts.ownerVisiblePhotos}
        icon={<IconPhoto className="size-4" />}
      />
      <LogMetric
        label="Review queue"
        value={counts.photosAwaitingReview}
        icon={<IconShieldCheck className="size-4" />}
      />
    </div>
  )
}

/** Print checked logs, or the logs matching a date range and author. */
export function DailyLogPrintOptions({
  selectedLogs,
  printStartDate,
  setPrintStartDate,
  printEndDate,
  setPrintEndDate,
  printAuthor,
  setPrintAuthor,
  printAuthorOptions,
  hasUnknownPrintAuthor,
  dateAuthorPrintLogs,
  printDailyLogs,
}: {
  readonly selectedLogs: readonly ProjectDailyLogItem[]
  readonly printStartDate: string
  readonly setPrintStartDate: (value: string) => void
  readonly printEndDate: string
  readonly setPrintEndDate: (value: string) => void
  readonly printAuthor: string
  readonly setPrintAuthor: (value: string) => void
  readonly printAuthorOptions: readonly string[]
  readonly hasUnknownPrintAuthor: boolean
  readonly dateAuthorPrintLogs: readonly ProjectDailyLogItem[]
  readonly printDailyLogs: (
    targetLogs: readonly ProjectDailyLogItem[],
    params: Readonly<Record<string, string>>
  ) => void
}): React.ReactElement {
  return (
    <section className="border-y py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Print Daily Logs</h2>
          <p className="text-sm text-muted-foreground">
            Print checked logs, or choose a date range and author.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={selectedLogs.length === 0}
          onClick={() => printDailyLogs(selectedLogs, { logIds: selectedLogs.map((log) => log.id).join(",") })}
        >
          <IconEye className="size-4" />
          Print Preview ({selectedLogs.length} selected)
        </Button>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="daily-log-print-start">From date</Label>
          <Input
            id="daily-log-print-start"
            type="date"
            value={printStartDate}
            onChange={(event) =>
              setPrintStartDate(event.currentTarget.value)
            }
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="daily-log-print-end">Through date</Label>
          <Input
            id="daily-log-print-end"
            type="date"
            value={printEndDate}
            onChange={(event) =>
              setPrintEndDate(event.currentTarget.value)
            }
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="daily-log-print-author">Author</Label>
          <SearchableCombobox
            id="daily-log-print-author"
            value={printAuthor}
            onValueChange={setPrintAuthor}
            ariaLabel="Filter daily logs by author"
            placeholder="All authors"
            searchPlaceholder="Search authors..."
            className="h-9 min-w-0"
            options={[
              { value: ALL_DAILY_LOG_AUTHORS, label: "All authors" },
              ...printAuthorOptions.map((author) => ({
                value: author,
                label: author,
              })),
              ...(hasUnknownPrintAuthor
                ? [{ value: UNKNOWN_DAILY_LOG_AUTHOR, label: "Imported / no author" }]
                : []),
            ]}
          />
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            disabled={dateAuthorPrintLogs.length === 0}
            onClick={() =>
              printDailyLogs(dateAuthorPrintLogs, { start: printStartDate, end: printEndDate, author: printAuthor })
            }
          >
            <IconEye className="size-4" />
            Print Preview ({dateAuthorPrintLogs.length} matching)
          </Button>
        </div>
      </div>
    </section>
  )
}

/** Filter, select and delete logs, and build an owner update draft from the selection. */
export function DailyLogOwnerUpdateBuilder({
  filter,
  setFilter,
  onSelectShown,
  onClearSelection,
  selectedCount,
  selectedInViewCount,
  shownCount,
  canDeleteAny,
  deletableSelectedIds,
  isPending,
  onDeleteSelected,
  onDraftOwnerUpdate,
  draftDisabled,
  message,
}: {
  readonly filter: LogFilter
  readonly setFilter: (filter: LogFilter) => void
  readonly onSelectShown: () => void
  readonly onClearSelection: () => void
  readonly selectedCount: number
  readonly selectedInViewCount: number
  readonly shownCount: number
  readonly canDeleteAny: boolean
  readonly deletableSelectedIds: readonly string[]
  readonly isPending: boolean
  readonly onDeleteSelected: () => void
  readonly onDraftOwnerUpdate: () => void
  readonly draftDisabled: boolean
  readonly message: string | null
}): React.ReactElement {
  return (
    <section
      id="owner-update-builder"
      className="scroll-mt-4 rounded-lg border p-3 sm:p-4"
    >
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="text-sm font-semibold">Owner update builder</h2>
        <ContextualHelpBeacon topicId="daily.logs.draft-owner-update" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filter}
            onValueChange={(value) => setFilter(filterValue(value))}
          >
            <SelectTrigger aria-label="Filter daily logs" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All logs</SelectItem>
              <SelectItem value="needs_review">Needs review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="owner_visible">Owner visible</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onSelectShown}>
            Select shown
          </Button>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            Clear
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="text-sm text-muted-foreground">
            {selectedCount} selected
            {selectedCount !== selectedInViewCount
              ? ` · ${selectedInViewCount} in view`
              : ""}{" "}
            · {shownCount} shown
          </div>
          {canDeleteAny && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending || deletableSelectedIds.length === 0}
              onClick={onDeleteSelected}
              title={
                deletableSelectedIds.length < selectedCount
                  ? "Some selected logs can't be deleted by you (approved, shared with the owner, written by someone else, or used in an owner update)."
                  : undefined
              }
            >
              <IconTrash className="size-4" />
              Delete selected
              {deletableSelectedIds.length > 0 && deletableSelectedIds.length < selectedCount
                ? ` (${deletableSelectedIds.length})`
                : ""}
            </Button>
          )}
          <Button
            size="sm"
            onClick={onDraftOwnerUpdate}
            disabled={draftDisabled}
          >
            <IconMailForward className="size-4" />
            Build draft from selected
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Selected logs create a staff-only owner update draft. Only photos
        that have been approved and marked Owner visible are attached, and
        nothing is shared with the owner until the draft is published.
      </p>
      {message && (
        <p className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          {message}
        </p>
      )}
    </section>
  )
}

/** Library photos not yet tied to a daily log. */
export function DailyLogUnattachedPhotos({
  workspace,
}: {
  readonly workspace: ProjectDailyLogWorkspace
}): React.ReactElement {
  return (
    <section className="rounded-lg border p-3 sm:p-4">
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
            <DailyLogPhotoThumb
              photo={photo}
              projectId={workspace.project.id}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
