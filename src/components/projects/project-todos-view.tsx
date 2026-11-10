"use client"

import * as React from "react"
import { IconSearch } from "@tabler/icons-react"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type { ProjectTodoItem } from "@/lib/domain/operations/types"
import { todoFilterForItem, todoMatchesSearch } from "@/lib/project-todo-list"
import {
  recordStatusFilterOptions,
  recordStatusLabel,
  recordStatusMatchesFilter,
  type RecordStatusFilter,
  type RecordStatusList,
} from "@/lib/domain/record-statuses/rules"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { formatDate } from "@/lib/format"
import { RecordTable, useRecordTable } from "@/components/record-table"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { ProjectTodoEditDialog } from "@/components/projects/project-todo-edit-dialog"
import { ProjectTodoBulkActions } from "@/components/projects/project-todo-bulk-actions"
import { projectTodoColumns } from "@/components/projects/project-todo-table-columns"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { Input } from "@/components/ui/input"
import { RecordDrawer } from "@/components/record-drawer"
import { PageHeader } from "@/components/page-header"

export function ProjectTodosView({
  projectId,
  projectLabel,
  items,
  initialItemId,
  assigneeOptions,
  canManage,
  canDelete = false,
  initialCreateOpen = false,
  statuses,
}: {
  /** The company's to-do statuses (Settings › Statuses): buttons, labels, Open and choices. */
  readonly statuses: RecordStatusList
  readonly projectId: string
  readonly projectLabel: string
  readonly items: readonly ProjectTodoItem[]
  readonly initialItemId: string | null
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly canManage: boolean
  readonly canDelete?: boolean
  readonly initialCreateOpen?: boolean
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const initialItem = items.find((item) => item.id === initialItemId) ?? null
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState<RecordStatusFilter>(() => todoFilterForItem(initialItem, statuses))
  const [editingItem, setEditingItem] = React.useState<ProjectTodoItem | null>(null)
  const visibleItems = React.useMemo(
    () =>
      items.filter(
        (item) =>
          recordStatusMatchesFilter(statuses, item.status, filter) &&
          todoMatchesSearch(item, query, developerModeEnabled, statuses),
      ),
    [items, filter, query, developerModeEnabled, statuses],
  )
  const columns = React.useMemo(
    () =>
      projectTodoColumns({ projectId, canManage, developerModeEnabled, onOpen: setEditingItem, statuses }),
    [projectId, canManage, developerModeEnabled, statuses],
  )
  const table = useRecordTable({
    data: visibleItems,
    columns,
    getRowId: (item) => item.id,
    resetKey: `${filter}:${query}`,
    initialItemId,
    revealReady: filter === todoFilterForItem(initialItem, statuses),
    enableSelection: canManage,
    sheetId: "todos.job",
  })

  React.useEffect(() => {
    if (initialItemId) {
      const item = items.find((candidate) => candidate.id === initialItemId)
      if (item) setFilter(todoFilterForItem(item, statuses))
    }
    // URL navigation reveals a linked row, while refreshes keep the chosen view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItemId])

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5 p-4 md:p-6">
      <PageHeader
        className="mb-0"
        eyebrow={projectLabel}
        title="To-dos"
        actions={
          canManage ? (
            <ProjectTaskCreateButton
              projectId={projectId}
              sourceLabel="Project"
              sourceRecordId={null}
              sourceRecordNumber={null}
              sourceHref={null}
              defaultTitle=""
              defaultDescription={null}
              defaultAssigneeName={null}
              defaultCompanyName={null}
              defaultDueDate={null}
              defaultPriority="normal"
              assigneeOptions={assigneeOptions}
              defaultOpen={initialCreateOpen}
              quickAddEnabled
            />
          ) : null
        }
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xl">
          <IconSearch
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            aria-label="Search to-dos"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, description, assignee, or author…"
            className="pl-9"
          />
        </div>
        <StatusFilterBar
          kind="button"
          label="Filter to-dos by status"
          options={recordStatusFilterOptions(statuses, items.map((item) => ({ status: item.status, count: 1 })))}
          selected={filter}
          onSelect={setFilter}
        />
      </div>
      {initialItemId && !initialItem && (
        <p
          role="alert"
          className="border-l-2 border-destructive px-3 py-2 text-sm text-destructive"
        >
          The linked to-do was not found in this project.
        </p>
      )}
      {canManage && (
        <ProjectTodoBulkActions projectId={projectId} table={table} canDelete={canDelete} />
      )}
      <RecordTable
        table={table}
        itemLabel="to-dos"
        emptyMessage="No to-dos match this view."
        focusedRowId={initialItemId}
        rowIdPrefix="todo"
        onRowOpen={setEditingItem}
      />
      {editingItem &&
        (canManage ? (
          <ProjectTodoEditDialog
            key={`${editingItem.id}-${editingItem.updatedAt}`}
            projectId={projectId}
            item={editingItem}
            statuses={statuses}
            assigneeOptions={assigneeOptions}
            canDelete={canDelete}
            open
            onOpenChange={(open) => {
              if (!open) setEditingItem(null)
            }}
          />
        ) : (
          <RecordDrawer
            open
            onOpenChange={(open) => {
              if (!open) setEditingItem(null)
            }}
            title={editingItem.title}
            description={editingItem.sourceRecordNumber ?? "Project to-do"}
          >
            <div className="grid gap-4">
              <p className="whitespace-pre-wrap break-words text-sm">
                {editingItem.description || "No description."}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt>Status</dt>
                <dd>{recordStatusLabel(statuses, editingItem.status)}</dd>
                <dt>Assigned to</dt>
                <dd>{editingItem.assigneeName ?? editingItem.companyName ?? "Unassigned"}</dd>
                <dt>Due date</dt>
                <dd>{formatDate(editingItem.dueDate, "medium", "No due date")}</dd>
                <dt>Author</dt>
                <dd>{editingItem.authorName ?? "Not recorded"}</dd>
              </dl>
            </div>
          </RecordDrawer>
        ))}
    </div>
  )
}
