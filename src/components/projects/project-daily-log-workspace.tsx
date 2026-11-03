"use client"

import * as React from "react"
import { useQuickAddEntry } from "@/hooks/use-quick-add-entry"
import { useRouter } from "next/navigation"

import {
  draftOwnerUpdateFromDailyLogs,
  updateDailyLogReview,
  type ProjectDailyLogItem,
  type ProjectDailyLogWorkspace as ProjectDailyLogWorkspaceData,
} from "@/app/actions/project-field"
import { deleteProjectDailyLogs } from "@/app/actions/daily-log-delete"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { CompassLoadingOverlay } from "@/components/compass-loader"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { DailyLogCard } from "@/components/projects/daily-log/daily-log-card"
import {
  DailyLogEditForm,
  DailyLogNewForm,
} from "@/components/projects/daily-log/daily-log-forms"
import {
  DailyLogDeleteDialog,
  DailyLogMetrics,
  DailyLogOwnerUpdateBuilder,
  DailyLogPageHeader,
  DailyLogPrintOptions,
  DailyLogUnattachedPhotos,
} from "@/components/projects/daily-log/daily-log-panels"
import { DailyLogUploadPanel } from "@/components/projects/daily-log/daily-log-upload-panel"
import { useDailyLogForms } from "@/components/projects/daily-log/use-daily-log-forms"
import { useDailyLogUpload } from "@/components/projects/daily-log/use-daily-log-upload"
import { useDailyLogPrint } from "@/components/projects/daily-log/use-daily-log-print"
import {
  matchesFilter,
  selectedLogIds,
  type LogFilter,
} from "@/lib/daily-logs/workspace-view"

export function ProjectDailyLogWorkspace({
  workspace,
  assigneeOptions,
  initialShowNewLog = false,
}: {
  readonly workspace: ProjectDailyLogWorkspaceData
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly initialShowNewLog?: boolean
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const router = useRouter()
  const [logs, setLogs] =
    React.useState<readonly ProjectDailyLogItem[]>(workspace.logs)
  const [filter, setFilter] = React.useState<LogFilter>("all")
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([])
  const [showNewLog, setShowNewLog] = React.useState(initialShowNewLog)
  useQuickAddEntry("daily-log", () => setShowNewLog(true))
  const [showPrintOptions, setShowPrintOptions] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  // Logs waiting on delete confirmation (one from the edit form, or the selection).
  const [pendingDeleteIds, setPendingDeleteIds] = React.useState<readonly string[]>([])
  const [isPending, startTransition] = React.useTransition()
  // Separate so the loading overlay covers only draft building, through the
  // navigation to the new draft.
  const [isBuildingDraft, startDraftTransition] = React.useTransition()
  const forms = useDailyLogForms({
    workspace,
    setMessage,
    startTransition,
    setShowNewLog,
    refresh: () => router.refresh(),
    push: (href) => router.push(href),
  })
  const upload = useDailyLogUpload({
    projectId: workspace.project.id,
    setMessage,
    refresh: () => router.refresh(),
  })
  const { setUploadingLogId } = upload

  React.useEffect(() => {
    setLogs(workspace.logs)
    setSelectedIds([])
    setUploadingLogId(null)
  }, [workspace.logs, workspace.project.id, setUploadingLogId])

  const filteredLogs = React.useMemo(
    () => logs.filter((log) => matchesFilter(log, filter)),
    [filter, logs]
  )
  const selectedIdsInView = selectedLogIds(filteredLogs, selectedIds)
  const selectedLogs = React.useMemo(
    () => logs.filter((log) => selectedIds.includes(log.id)),
    [logs, selectedIds]
  )
  const ownerUpdateSelectedIds = selectedLogs.map((log) => log.id)
  const deletableIds = React.useMemo(
    () => new Set(workspace.deletableLogIds),
    [workspace.deletableLogIds]
  )
  const deletableSelectedIds = ownerUpdateSelectedIds.filter((id) => deletableIds.has(id))
  const pendingDeleteLogs = logs.filter((log) => pendingDeleteIds.includes(log.id))
  const projectLabel = workspace.project.projectNumber ?? workspace.project.name
  const print = useDailyLogPrint({
    logs,
    projectId: workspace.project.id,
    projectLabel,
    setMessage,
  })
  const draftDisabled = isPending || isBuildingDraft || ownerUpdateSelectedIds.length === 0

  function confirmDeleteLogs(): void {
    const ids = pendingDeleteIds
    setMessage(null)
    startTransition(async () => {
      const result = await deleteProjectDailyLogs(workspace.project.id, ids)
      setPendingDeleteIds([])
      if (result.success) {
        setLogs((current) => current.filter((log) => !ids.includes(log.id)))
        setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
        if (forms.editingLogId && ids.includes(forms.editingLogId)) forms.clearEditingLog()
        setMessage(
          result.deletedCount === 1
            ? "Daily log deleted. Its files are still in the project's photos."
            : `${result.deletedCount} daily logs deleted. Their files are still in the project's photos.`
        )
        router.refresh()
      } else {
        setMessage(result.error)
      }
    })
  }

  function toggleLog(logId: string): void {
    setSelectedIds((current) =>
      current.includes(logId)
        ? current.filter((id) => id !== logId)
        : [...current, logId]
    )
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
    const dailyLogIds = ownerUpdateSelectedIds
    setMessage(null)
    startDraftTransition(async () => {
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
    <>
    {isBuildingDraft && (
      <CompassLoadingOverlay label="Building the owner update draft…" />
    )}
    <DailyLogDeleteDialog
      pendingDeleteIds={pendingDeleteIds}
      pendingDeleteLogs={pendingDeleteLogs}
      isPending={isPending}
      onCancel={() => setPendingDeleteIds([])}
      onConfirm={confirmDeleteLogs}
    />
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <DailyLogPageHeader
          project={workspace.project}
          projectLabel={projectLabel}
          showNewLog={showNewLog}
          onToggleNewLog={() => setShowNewLog((current) => !current)}
          savedButton={forms.savedButton}
          showPrintOptions={showPrintOptions}
          onTogglePrintOptions={() => setShowPrintOptions((current) => !current)}
          onDraftOwnerUpdate={draftOwnerUpdate}
          draftDisabled={draftDisabled}
        />

        <DailyLogMetrics logs={logs} counts={workspace.counts} />

        {showNewLog && (
          <DailyLogNewForm forms={forms} form={workspace.form} isPending={isPending} />
        )}

        {showPrintOptions && (
          <DailyLogPrintOptions selectedLogs={selectedLogs} {...print} />
        )}

        <DailyLogOwnerUpdateBuilder
          filter={filter}
          setFilter={setFilter}
          onSelectShown={() => setSelectedIds(filteredLogs.map((log) => log.id))}
          onClearSelection={() => setSelectedIds([])}
          selectedCount={selectedLogs.length}
          selectedInViewCount={selectedIdsInView.length}
          shownCount={filteredLogs.length}
          canDeleteAny={deletableIds.size > 0}
          deletableSelectedIds={deletableSelectedIds}
          isPending={isPending}
          onDeleteSelected={() => setPendingDeleteIds(deletableSelectedIds)}
          onDraftOwnerUpdate={draftOwnerUpdate}
          draftDisabled={draftDisabled}
          message={message}
        />

        <div className="grid grid-cols-1 gap-3">
          {filteredLogs.map((log) => (
            <DailyLogCard
              key={log.id}
              log={log}
              projectId={workspace.project.id}
              assigneeOptions={assigneeOptions}
              savedLogRules={forms.savedLogSetup?.rules ?? null}
              developerModeEnabled={developerModeEnabled}
              selected={selectedIds.includes(log.id)}
              onToggleSelected={() => toggleLog(log.id)}
              isPending={isPending}
              isUploading={upload.isUploading}
              editing={forms.editingLogId === log.id}
              uploadingFiles={upload.uploadingLogId === log.id}
              onEdit={() => forms.startEditingLog(log)}
              onAddFiles={() => upload.startUploadingFiles(log)}
              onReview={(reviewStatus, isClientVisible) => updateReview(log, reviewStatus, isClientVisible)}
              editForm={
                forms.editingLogId === log.id ? (
                  <DailyLogEditForm
                    log={log}
                    forms={forms}
                    form={workspace.form}
                    isPending={isPending}
                    deletable={deletableIds.has(log.id)}
                    onDelete={() => setPendingDeleteIds([log.id])}
                  />
                ) : null
              }
              uploadPanel={
                upload.uploadingLogId === log.id ? (
                  <DailyLogUploadPanel
                    log={log}
                    upload={upload}
                    schedulePhases={workspace.schedulePhases}
                  />
                ) : null
              }
            />
          ))}

          {filteredLogs.length === 0 && (
            <section className="rounded-lg border p-6 text-sm text-muted-foreground">
              No daily logs match this filter yet.
            </section>
          )}
        </div>

        {workspace.unattachedPhotos.length > 0 && (
          <DailyLogUnattachedPhotos workspace={workspace} />
        )}
      </div>
    </main>
    </>
  )
}
