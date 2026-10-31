"use client"

import type {
  ScheduleData,
} from "@/lib/schedule/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { ScheduleItemFormDialog } from "../schedule-item-form-dialog"
import { ScheduleTemplateDialog } from "../schedule-template-dialog"
import { ScheduleTemplateBulkImportDialog } from "../schedule-template-bulk-import-dialog"
import { ScheduleSaveTemplateDialog } from "../schedule-save-template-dialog"

/** New-item, template import, project setup and save-as-template dialogs. */
export function ScheduleProjectDialogs({
  projectId,
  projectName,
  initialData,
  assigneeOptions,
  projectTaskIds,
  shiftReasonRequired,
  taskFormOpen,
  setTaskFormOpen,
  bulkTemplateDialogOpen,
  setBulkTemplateDialogOpen,
  templateDialogOpen,
  setTemplateDialogOpen,
  saveTemplateDialogOpen,
  setSaveTemplateDialogOpen,
}: {
  readonly projectId: string
  readonly projectName: string
  readonly initialData: ScheduleData
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly projectTaskIds: ReadonlySet<string>
  readonly shiftReasonRequired: boolean
  readonly taskFormOpen: boolean
  readonly setTaskFormOpen: (open: boolean) => void
  readonly bulkTemplateDialogOpen: boolean
  readonly setBulkTemplateDialogOpen: (open: boolean) => void
  readonly templateDialogOpen: boolean
  readonly setTemplateDialogOpen: (open: boolean) => void
  readonly saveTemplateDialogOpen: boolean
  readonly setSaveTemplateDialogOpen: (open: boolean) => void
}) {
  return (
    <>
      <ScheduleItemFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        projectId={projectId}
        editingTask={null}
        allTasks={initialData.tasks.filter(
          (task) => task.projectId === projectId
        )}
        dependencies={initialData.dependencies}
        exceptions={initialData.exceptions.filter(
          (exception) => exception.projectId === projectId
        )}
        assigneeOptions={assigneeOptions}
        onBulkTemplateImport={() => {
          setTaskFormOpen(false)
          setBulkTemplateDialogOpen(true)
        }}
        shiftReasonRequired={shiftReasonRequired}
      />
      <ScheduleTemplateBulkImportDialog
        open={bulkTemplateDialogOpen}
        onOpenChange={setBulkTemplateDialogOpen}
        projectId={projectId}
      />
      <ScheduleTemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        projectId={projectId}
      />
      <ScheduleSaveTemplateDialog
        open={saveTemplateDialogOpen}
        onOpenChange={setSaveTemplateDialogOpen}
        projectId={projectId}
        projectName={projectName}
        itemCount={projectTaskIds.size}
        dependencyCount={
          initialData.dependencies.filter((dependency) =>
            projectTaskIds.has(dependency.successorId)
          ).length
        }
      />
    </>
  )
}
