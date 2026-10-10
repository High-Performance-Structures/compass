"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconChecks, IconX } from "@tabler/icons-react"
import { toast } from "sonner"
import { updateProjectJobStatuses } from "@/app/actions/project-bulk-status"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"
import { cn } from "@/lib/utils"

type ProjectSelection = {
  readonly enabled: boolean
  readonly active: boolean
  readonly selectedIds: ReadonlySet<string>
  readonly toggle: (projectId: string) => void
  readonly setMany: (projectIds: readonly string[], selected: boolean) => void
  readonly setActive: (active: boolean) => void
  readonly clear: () => void
}

const ProjectSelectionContext = React.createContext<ProjectSelection | null>(null)

/** Shares project-card selection across the hub's lanes and department views. */
export function ProjectSelectionProvider({
  enabled,
  children,
}: {
  readonly enabled: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  const [active, setActiveState] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set())
  const value = React.useMemo<ProjectSelection>(() => ({
    enabled,
    active: enabled && active,
    selectedIds,
    toggle: (projectId) =>
      setSelectedIds((current) => {
        const next = new Set(current)
        if (next.has(projectId)) next.delete(projectId)
        else next.add(projectId)
        return next
      }),
    setMany: (projectIds, selected) =>
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const id of projectIds) {
          if (selected) next.add(id)
          else next.delete(id)
        }
        return next
      }),
    setActive: (next) => {
      setActiveState(next)
      if (!next) setSelectedIds(new Set())
    },
    clear: () => setSelectedIds(new Set()),
  }), [active, enabled, selectedIds])
  return <ProjectSelectionContext.Provider value={value}>{children}</ProjectSelectionContext.Provider>
}

function useProjectSelection(): ProjectSelection | null {
  return React.useContext(ProjectSelectionContext)
}

/** Checkbox on a project card, shown only while selecting. */
export function ProjectSelectCheckbox({
  projectId,
  label,
}: {
  readonly projectId: string
  readonly label: string
}): React.ReactElement | null {
  const selection = useProjectSelection()
  if (!selection?.active) return null
  return (
    <input
      type="checkbox"
      className="mt-0.5 size-4 shrink-0 rounded border accent-primary"
      checked={selection.selectedIds.has(projectId)}
      onChange={() => selection.toggle(projectId)}
      aria-label={`Select ${label}`}
    />
  )
}

/** Whether a card is currently selected (for highlighting). */
export function useProjectSelected(projectId: string): boolean {
  const selection = useProjectSelection()
  return Boolean(selection?.active && selection.selectedIds.has(projectId))
}

/** "Select" toggle plus select-all for the projects in view. */
export function ProjectSelectionToggle({
  visibleProjectIds,
}: {
  readonly visibleProjectIds: readonly string[]
}): React.ReactElement | null {
  const selection = useProjectSelection()
  if (!selection?.enabled || visibleProjectIds.length === 0) return null
  if (!selection.active) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => selection.setActive(true)}>
        <IconChecks className="size-4" />
        Select
      </Button>
    )
  }
  const allSelected = visibleProjectIds.every((id) => selection.selectedIds.has(id))
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => selection.setMany(visibleProjectIds, !allSelected)}
      >
        {allSelected ? "Unselect shown" : `Select all ${visibleProjectIds.length} shown`}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => selection.setActive(false)}>
        Done
      </Button>
    </div>
  )
}

const STATUS_OPTIONS = PROJECT_JOB_STATUS_DEFINITIONS.map((status) => ({ value: status.id, label: status.label }))

/** Bottom bar for changing the status of every selected project at once. */
export function ProjectBulkStatusBar(): React.ReactElement | null {
  const selection = useProjectSelection()
  const router = useRouter()
  const [statusId, setStatusId] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  if (!selection?.active) return null
  const count = selection.selectedIds.size

  function apply(): void {
    if (!selection || count === 0 || !statusId) return
    const ids = [...selection.selectedIds]
    const label = STATUS_OPTIONS.find((option) => option.value === statusId)?.label ?? "the new status"
    startTransition(async () => {
      const result = await updateProjectJobStatuses(ids, statusId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.failed.length === 0) {
        toast.success(`${result.updated} ${result.updated === 1 ? "project" : "projects"} set to ${label}.`)
        selection.clear()
      } else {
        toast.warning(
          `${result.updated} set to ${label}; ${result.failed.length} not changed (${result.failed[0]?.error ?? "permission or status issue"}).`
        )
        // Keep only the ones that failed selected so they can be retried or reviewed.
        selection.clear()
        selection.setMany(result.failed.map((item) => item.projectId), true)
      }
      router.refresh()
    })
  }

  return (
    <div
      role="region"
      aria-label="Change status of selected projects"
      className={cn(
        "sticky bottom-3 z-20 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur",
      )}
    >
      <p className="text-sm font-medium tabular-nums">
        {count} {count === 1 ? "project" : "projects"} selected
      </p>
      <SearchableCombobox
        className="h-8 w-[240px] bg-background"
        popoverClassName="min-w-[16rem]"
        value={statusId}
        onValueChange={setStatusId}
        options={STATUS_OPTIONS}
        ariaLabel="New status for selected projects"
        placeholder="Choose new status"
        searchPlaceholder="Search statuses..."
        emptyMessage="No matching status."
        disabled={pending}
      />
      <Button type="button" size="sm" disabled={pending || count === 0 || !statusId} onClick={apply}>
        {pending ? "Changing…" : "Change status"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto size-8"
        aria-label="Stop selecting"
        onClick={() => selection.setActive(false)}
      >
        <IconX className="size-4" />
      </Button>
    </div>
  )
}
