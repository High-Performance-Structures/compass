"use client"

import { useEffect, useState, type ReactElement } from "react"
import { createPortal } from "react-dom"

import type { ProjectBudgetSummary } from "@/app/actions/project-budget"
import type { ProjectContactsSummary } from "@/app/actions/project-contacts"
import type { ProjectFieldSummary } from "@/app/actions/project-field"
import type {
  ProjectOperationsSummary,
  ProjectSageSyncQueue,
} from "@/app/actions/project-operations"
import type { ProjectRegistry } from "@/app/actions/project-registry"
import type { ProjectRfiSummary } from "@/app/actions/project-rfis"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProjectManagerWorkflowPanel } from "@/components/projects/project-manager-workflow-panel"
import { ProjectRegistryPanel } from "@/components/projects/project-registry-panel"
import { ProjectSageSyncQueuePanel } from "@/components/projects/project-sage-sync-queue-panel"
import {
  PROJECT_WORKFLOW_ROLE_LENSES,
  isProjectWorkflowRoleId,
  roleLensForId,
  workflowRoleIdFromString,
  workflowRoleIsAllowed,
  type ProjectWorkflowRoleId,
  type ProjectWorkspaceMode,
} from "@/lib/project-workflow-roles"

const ROLE_STORAGE_PREFIX = "compass-project-role-lens"
const MODE_STORAGE_PREFIX = "compass-project-workspace-mode"

function storedWorkflowRole(projectId: string): ProjectWorkflowRoleId | null {
  try {
    return workflowRoleIdFromString(
      window.localStorage.getItem(`${ROLE_STORAGE_PREFIX}:${projectId}`),
    )
  } catch {
    return null
  }
}

function storedWorkspaceMode(
  projectId: string,
  canUseDeveloperMode: boolean,
): ProjectWorkspaceMode | null {
  if (!canUseDeveloperMode) return null

  try {
    const value = window.localStorage.getItem(`${MODE_STORAGE_PREFIX}:${projectId}`)
    return value === "developer" || value === "worker" ? value : null
  } catch {
    return null
  }
}

function saveWorkflowRole(
  projectId: string,
  roleId: ProjectWorkflowRoleId,
): void {
  try {
    window.localStorage.setItem(`${ROLE_STORAGE_PREFIX}:${projectId}`, roleId)
  } catch {
    // Local storage is a convenience, not an app dependency.
  }
}

function saveWorkspaceMode(
  projectId: string,
  mode: ProjectWorkspaceMode,
): void {
  try {
    window.localStorage.setItem(`${MODE_STORAGE_PREFIX}:${projectId}`, mode)
  } catch {
    // Local storage is a convenience, not an app dependency.
  }
}

function ProjectWorkspaceControlsPortal({
  projectId,
  activeRoleId,
  workspaceMode,
  canEditRegistry,
  allowedRoleIds,
  onActiveRoleChange,
  onWorkspaceModeChange,
}: {
  readonly projectId: string
  readonly activeRoleId: ProjectWorkflowRoleId
  readonly workspaceMode: ProjectWorkspaceMode
  readonly canEditRegistry: boolean
  readonly allowedRoleIds: readonly ProjectWorkflowRoleId[]
  readonly onActiveRoleChange: (roleId: ProjectWorkflowRoleId) => void
  readonly onWorkspaceModeChange: (isDeveloperMode: boolean) => void
}): ReactElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const availableRoles = PROJECT_WORKFLOW_ROLE_LENSES.filter((role) =>
    allowedRoleIds.includes(role.id)
  )
  const activeRole = roleLensForId(activeRoleId)
  const developerModeEnabled = canEditRegistry && workspaceMode === "developer"

  useEffect(() => {
    setTarget(document.getElementById(`project-workspace-controls-${projectId}`))
  }, [projectId])

  if (!target || (!canEditRegistry && availableRoles.length < 2)) return null

  return createPortal(
    <div className="mt-4 space-y-4 border-t pt-4">
      {canEditRegistry && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Workspace Mode
          </p>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className={!developerModeEnabled ? "font-medium" : ""}>
              Worker
            </span>
            <Switch
              checked={developerModeEnabled}
              onCheckedChange={onWorkspaceModeChange}
              aria-label="Toggle developer mode"
            />
            <span className={developerModeEnabled ? "font-medium" : ""}>
              Developer
            </span>
          </div>
        </div>
      )}

      {availableRoles.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Preview Role
          </p>
          <Select
            value={activeRoleId}
            onValueChange={(value) => {
              if (!isProjectWorkflowRoleId(value)) return
              if (!allowedRoleIds.includes(value)) return
              onActiveRoleChange(value)
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full bg-background"
              aria-label="Preview role dashboard"
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
        </div>
      )}
    </div>,
    target
  )
}

export function ProjectWorkspaceShell({
  projectId,
  totalTaskCount,
  pastDueCount,
  operationsSummary,
  contactsSummary,
  fieldSummary,
  budgetSummary,
  rfiSummary,
  registry,
  sageSyncQueue,
  canEditRegistry,
  initialRoleId,
  allowedRoleIds,
}: {
  readonly projectId: string
  readonly totalTaskCount: number
  readonly pastDueCount: number
  readonly operationsSummary: ProjectOperationsSummary | null
  readonly contactsSummary: ProjectContactsSummary | null
  readonly fieldSummary: ProjectFieldSummary | null
  readonly budgetSummary: ProjectBudgetSummary | null
  readonly rfiSummary: ProjectRfiSummary | null
  readonly registry: ProjectRegistry | null
  readonly sageSyncQueue: ProjectSageSyncQueue | null
  readonly canEditRegistry: boolean
  readonly initialRoleId: ProjectWorkflowRoleId
  readonly allowedRoleIds: readonly ProjectWorkflowRoleId[]
}): ReactElement | null {
  const [activeRoleId, setActiveRoleId] =
    useState<ProjectWorkflowRoleId>(initialRoleId)
  const [workspaceMode, setWorkspaceMode] =
    useState<ProjectWorkspaceMode>("worker")

  useEffect(() => {
    const savedRole = storedWorkflowRole(projectId)
    if (savedRole && workflowRoleIsAllowed(savedRole, allowedRoleIds)) {
      setActiveRoleId(savedRole)
    }

    const savedMode = storedWorkspaceMode(projectId, canEditRegistry)
    if (savedMode) setWorkspaceMode(savedMode)
  }, [allowedRoleIds, canEditRegistry, projectId])

  const developerModeEnabled = canEditRegistry && workspaceMode === "developer"

  function handleRoleChange(roleId: ProjectWorkflowRoleId): void {
    if (!workflowRoleIsAllowed(roleId, allowedRoleIds)) return

    setActiveRoleId(roleId)
    saveWorkflowRole(projectId, roleId)
  }

  function handleModeChange(isDeveloperMode: boolean): void {
    const nextMode = isDeveloperMode ? "developer" : "worker"
    setWorkspaceMode(nextMode)
    saveWorkspaceMode(projectId, nextMode)
  }

  if (allowedRoleIds.length === 0) return null

  return (
    <div className="space-y-4 sm:space-y-6">
      <ProjectWorkspaceControlsPortal
        projectId={projectId}
        activeRoleId={activeRoleId}
        workspaceMode={workspaceMode}
        canEditRegistry={canEditRegistry}
        allowedRoleIds={allowedRoleIds}
        onActiveRoleChange={handleRoleChange}
        onWorkspaceModeChange={handleModeChange}
      />

      {developerModeEnabled && (
        <section className="space-y-4 border-y py-4">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Developer Tools
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Project mapping, Sage sync queue, and workspace connections.
            </p>
          </div>
          <ProjectRegistryPanel projectId={projectId} registry={registry} />
          <ProjectSageSyncQueuePanel projectId={projectId} queue={sageSyncQueue} />
        </section>
      )}

      <ProjectManagerWorkflowPanel
        projectId={projectId}
        totalTaskCount={totalTaskCount}
        pastDueCount={pastDueCount}
        operationsSummary={operationsSummary}
        contactsSummary={contactsSummary}
        fieldSummary={fieldSummary}
        budgetSummary={budgetSummary}
        rfiSummary={rfiSummary}
        activeRoleId={activeRoleId}
        onActiveRoleChange={handleRoleChange}
        workspaceMode={workspaceMode}
        canUseDeveloperMode={canEditRegistry}
        allowedRoleIds={allowedRoleIds}
        showRoleControls={false}
      />
    </div>
  )
}
