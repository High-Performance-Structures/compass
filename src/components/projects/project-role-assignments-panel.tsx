"use client"

import * as React from "react"
import { IconPlus, IconTrash, IconUsersGroup } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  assignProjectRole,
  removeProjectRoleAssignment,
  type ProjectRoleAssignmentSummary,
} from "@/app/actions/project-role-assignments"
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
import { PROJECT_ASSIGNMENT_SCOPES } from "@/lib/project-role-assignments"
import { PROJECT_WORKFLOW_ROLE_LENSES } from "@/lib/project-workflow-roles"

type ProjectRoleAssignmentsPanelProps = {
  readonly projectId: string
  readonly summary: ProjectRoleAssignmentSummary
}

export function ProjectRoleAssignmentsPanel({
  projectId,
  summary,
}: ProjectRoleAssignmentsPanelProps) {
  const router = useRouter()
  const [userId, setUserId] = React.useState("")
  const [roleId, setRoleId] = React.useState("project-manager")
  const [assignmentScope, setAssignmentScope] = React.useState("all")
  const [notes, setNotes] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)

  const handleAssign = async () => {
    if (!userId) {
      toast.error("Choose a staff member first")
      return
    }

    setSaving(true)
    try {
      const result = await assignProjectRole({
        projectId,
        userId,
        roleId,
        assignmentScope,
        notes,
      })
      if (result.success) {
        toast.success("Project role assigned")
        setNotes("")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    } catch {
      toast.error("Unable to assign project role")
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (assignmentId: string) => {
    setRemovingId(assignmentId)
    try {
      const result = await removeProjectRoleAssignment({
        projectId,
        assignmentId,
      })
      if (result.success) {
        toast.success("Project role removed")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    } catch {
      toast.error("Unable to remove project role")
    } finally {
      setRemovingId(null)
    }
  }

  if (!summary.canManage && summary.assignments.length === 0) return null

  return (
    <section className="mb-4 border-y py-3 sm:mb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconUsersGroup className="size-4 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Project roles</h2>
            <p className="text-xs text-muted-foreground">
              Staff hats for this job, separate from account permissions.
            </p>
          </div>
        </div>
        <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {summary.assignments.length} assigned
        </p>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {summary.assignments.map((assignment) => (
          <div
            key={assignment.id}
            className="flex items-start justify-between gap-3 border-l-2 border-primary/60 py-2 pl-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="text-sm font-medium">{assignment.userName}</p>
                <p className="text-xs text-muted-foreground">
                  {assignment.roleLabel}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {assignment.scopeLabel} · {assignment.userEmail}
              </p>
              {assignment.notes && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {assignment.notes}
                </p>
              )}
            </div>
            {summary.canManage && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                disabled={removingId === assignment.id}
                onClick={() => void handleRemove(assignment.id)}
                title="Remove project role"
              >
                <IconTrash className="size-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {summary.assignments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No staff roles have been assigned on this project yet.
        </p>
      )}

      {summary.canManage && (
        <div className="mt-4 grid gap-3 border-t pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_minmax(0,1fr)_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs">Staff member</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose staff" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {summary.users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.label} · {user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Project role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_WORKFLOW_ROLE_LENSES.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Phase</Label>
            <Select value={assignmentScope} onValueChange={setAssignmentScope}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_ASSIGNMENT_SCOPES.map((scope) => (
                  <SelectItem key={scope.id} value={scope.id}>
                    {scope.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Note</Label>
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="flex items-end">
            <Button
              type="button"
              className="w-full lg:w-auto"
              disabled={saving}
              onClick={() => void handleAssign()}
            >
              <IconPlus className="size-4" />
              Assign
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
