"use client"

import { useEffect, useMemo, useState, type ReactElement } from "react"
import { IconLock, IconTools } from "@tabler/icons-react"

import type { ProjectBudgetSummary } from "@/app/actions/project-budget"
import type { ProjectContactsSummary } from "@/app/actions/project-contacts"
import type { ProjectFieldSummary } from "@/app/actions/project-field"
import type { ProjectOperationsSummary } from "@/app/actions/project-operations"
import type { ProjectRegistry } from "@/app/actions/project-registry"
import type { ProjectRfiSummary } from "@/app/actions/project-rfis"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { ProjectManagerWorkflowPanel } from "@/components/projects/project-manager-workflow-panel"
import { ProjectRegistryPanel } from "@/components/projects/project-registry-panel"
import {
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

export function ProjectWorkspaceShell({
  projectId,
  projectNumber,
  totalTaskCount,
  pastDueCount,
  operationsSummary,
  contactsSummary,
  fieldSummary,
  budgetSummary,
  rfiSummary,
  registry,
  canEditRegistry,
  initialRoleId,
  allowedRoleIds,
}: {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly totalTaskCount: number
  readonly pastDueCount: number
  readonly operationsSummary: ProjectOperationsSummary | null
  readonly contactsSummary: ProjectContactsSummary | null
  readonly fieldSummary: ProjectFieldSummary | null
  readonly budgetSummary: ProjectBudgetSummary | null
  readonly rfiSummary: ProjectRfiSummary | null
  readonly registry: ProjectRegistry | null
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
  const modeDescription = useMemo(() => {
    if (!canEditRegistry) {
      return "Developer tools are restricted to admin-owner and secondary admin roles."
    }
    if (developerModeEnabled) {
      return "Registry, integrations, and buildout controls are visible for this project."
    }
    return "Registry and integration controls stay hidden while you work the job."
  }, [canEditRegistry, developerModeEnabled])

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
      {canEditRegistry && (
        <section className="rounded-xl border bg-emerald-950/[0.03] p-3 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              {developerModeEnabled ? (
                <IconTools className="mt-0.5 size-4 text-emerald-700" />
              ) : (
                <IconLock className="mt-0.5 size-4 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">
                  Work mode / developer mode
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {modeDescription}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={developerModeEnabled ? "secondary" : "outline"}>
                {developerModeEnabled ? "Developer mode" : "Worker mode"}
              </Badge>
              <Switch
                checked={developerModeEnabled}
                onCheckedChange={handleModeChange}
                aria-label="Toggle developer mode"
              />
            </div>
          </div>
        </section>
      )}

      <ProjectManagerWorkflowPanel
        projectId={projectId}
        projectNumber={projectNumber}
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
      />

      {developerModeEnabled && (
        <ProjectRegistryPanel projectId={projectId} registry={registry} />
      )}
    </div>
  )
}
