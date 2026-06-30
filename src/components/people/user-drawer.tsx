"use client"

import * as React from "react"
import { IconMail, IconPlus, IconTrash, IconUser } from "@tabler/icons-react"
import { toast } from "sonner"

import type { ProjectListItem } from "@/app/actions/projects"
import type { UserWithRelations } from "@/app/actions/users"
import { assignUserToProject, updateUserRole } from "@/app/actions/users"
import {
  USER_ROLE_OPTIONS,
  userRoleDescription,
  userRoleLabel,
} from "@/lib/user-roles"
import { Badge } from "@/components/ui/badge"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface UserDrawerProps {
  user: UserWithRelations | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUserUpdated?: () => void
  canManageUsers?: boolean
  projects?: readonly ProjectListItem[]
}

type ProjectAssignmentDraft = {
  readonly draftId: string
  readonly projectId: string
  readonly role: string
}

type ProjectAssignmentPatch = {
  readonly projectId?: string
  readonly role?: string
}

function createProjectAssignmentDraft(role: string): ProjectAssignmentDraft {
  return {
    draftId: crypto.randomUUID(),
    projectId: "",
    role,
  }
}

export function UserDrawer({
  user,
  open,
  onOpenChange,
  onUserUpdated,
  canManageUsers = false,
  projects = [],
}: UserDrawerProps) {
  const [saving, setSaving] = React.useState(false)
  const [savingProjectAccess, setSavingProjectAccess] = React.useState(false)
  const [selectedRole, setSelectedRole] = React.useState<string>("office")
  const [projectAssignments, setProjectAssignments] = React.useState<
    ProjectAssignmentDraft[]
  >(() => [createProjectAssignmentDraft("office")])

  React.useEffect(() => {
    if (user) {
      setSelectedRole(user.role)
      setProjectAssignments([createProjectAssignmentDraft(user.role)])
    }
  }, [user])

  if (!user) return null

  const assignedProjectIds = new Set(
    user.assignedProjects.map((project) => project.id)
  )
  const availableProjects = projects.filter(
    (project) => !assignedProjectIds.has(project.id)
  )

  const formatProjectLabel = (project: {
    readonly projectNumber: string | null
    readonly name: string
  }): string =>
    project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name

  const handleSaveRole = async () => {
    if (selectedRole === user.role) {
      toast.info("No changes to save")
      return
    }

    setSaving(true)
    try {
      const result = await updateUserRole(user.id, selectedRole)
      if (result.success) {
        toast.success("User role updated")
        onUserUpdated?.()
      } else {
        toast.error(result.error || "Failed to update role")
      }
    } catch (error) {
      toast.error("Failed to update role")
    } finally {
      setSaving(false)
    }
  }

  const availableProjectsForDraft = (
    draft: ProjectAssignmentDraft
  ): readonly ProjectListItem[] => {
    const selectedProjectIds = new Set(
      projectAssignments
        .filter((item) => item.draftId !== draft.draftId)
        .map((item) => item.projectId)
        .filter(Boolean)
    )

    return availableProjects.filter(
      (project) =>
        project.id === draft.projectId || !selectedProjectIds.has(project.id)
    )
  }

  const updateProjectAssignment = (
    draftId: string,
    patch: ProjectAssignmentPatch
  ) => {
    setProjectAssignments((current) =>
      current.map((draft) =>
        draft.draftId === draftId ? { ...draft, ...patch } : draft
      )
    )
  }

  const addProjectAssignment = () => {
    setProjectAssignments((current) => [
      ...current,
      createProjectAssignmentDraft(selectedRole),
    ])
  }

  const removeProjectAssignment = (draftId: string) => {
    setProjectAssignments((current) => {
      const next = current.filter((draft) => draft.draftId !== draftId)
      return next.length > 0 ? next : [createProjectAssignmentDraft(selectedRole)]
    })
  }

  const handleAssignProjects = async () => {
    const assignmentsToSave = projectAssignments.filter(
      (assignment) => assignment.projectId
    )

    if (assignmentsToSave.length === 0) {
      toast.error("Choose at least one project first")
      return
    }

    setSavingProjectAccess(true)
    try {
      for (const assignment of assignmentsToSave) {
        const result = await assignUserToProject(
          user.id,
          assignment.projectId,
          assignment.role
        )
        if (!result.success) {
          toast.error(result.error || "Failed to assign project access")
          return
        }
      }

      toast.success(
        assignmentsToSave.length === 1
          ? "Project access assigned"
          : "Project access assigned"
      )
      setProjectAssignments([createProjectAssignmentDraft(selectedRole)])
      onUserUpdated?.()
    } catch (error) {
      toast.error("Failed to assign project access")
    } finally {
      setSavingProjectAccess(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName || "user"}
                className="size-10 rounded-full"
              />
            ) : (
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <IconUser className="size-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <div className="text-lg font-semibold">
                {user.displayName || user.email.split("@")[0]}
              </div>
              <div className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
                <IconMail className="size-3" />
                {user.email}
              </div>
            </div>
          </SheetTitle>
          <SheetDescription>
            {canManageUsers
              ? "View and manage user details, roles, and permissions"
              : "View user details and assigned access"}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue={canManageUsers ? "access" : "profile"} className="mt-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                defaultValue={user.firstName || ""}
                disabled
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" defaultValue={user.lastName || ""} disabled />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" defaultValue={user.email} disabled />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                defaultValue={user.displayName || ""}
                disabled
              />
            </div>

            <div className="rounded-md border border-muted bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                Profile information is managed through WorkOS and cannot be
                edited directly.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="access" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="role">Primary Role</Label>
              {canManageUsers ? (
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger id="role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {USER_ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="secondary" className="w-fit">
                  {userRoleLabel(user.role)}
                </Badge>
              )}
              <p className="text-xs text-muted-foreground">
                {userRoleDescription(selectedRole)}
              </p>
              {canManageUsers && selectedRole !== user.role && (
                <Button
                  onClick={handleSaveRole}
                  disabled={saving}
                  className="w-full"
                  size="sm"
                >
                  {saving ? "Saving..." : "Save Role"}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label>Teams</Label>
              <div className="flex flex-wrap gap-2">
                {user.teams.length > 0 ? (
                  user.teams.map((team) => (
                    <Badge key={team.id} variant="outline">
                      {team.name}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Not assigned to any teams
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Groups</Label>
              <div className="flex flex-wrap gap-2">
                {user.groups.length > 0 ? (
                  user.groups.map((group) => (
                    <Badge key={group.id} variant="outline">
                      {group.name}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Not assigned to any groups
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Projects</Label>
              {user.assignedProjects.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {user.assignedProjects.map((project) => (
                    <Badge key={project.id} variant="outline">
                      {formatProjectLabel(project)} · {userRoleLabel(project.role)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not assigned to any projects
                </p>
              )}

              {canManageUsers && (
                <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Assign project access</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addProjectAssignment}
                      disabled={availableProjects.length === 0}
                    >
                      <IconPlus className="mr-1 size-3.5" />
                      Add Project
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {projectAssignments.map((draft, index) => {
                      const draftProjects = availableProjectsForDraft(draft)
                      return (
                        <div
                          key={draft.draftId}
                          className="space-y-2 rounded-md border bg-background p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              Project {index + 1}
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => removeProjectAssignment(draft.draftId)}
                              disabled={projectAssignments.length === 1}
                            >
                              <span className="sr-only">Remove project</span>
                              <IconTrash className="size-3.5" />
                            </Button>
                          </div>

                          <Select
                            value={draft.projectId}
                            onValueChange={(projectId) =>
                              updateProjectAssignment(draft.draftId, {
                                projectId,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose project" />
                            </SelectTrigger>
                            <SelectContent className="max-h-80">
                              {draftProjects.length > 0 ? (
                                draftProjects.map((project) => (
                                  <SelectItem key={project.id} value={project.id}>
                                    {formatProjectLabel(project)}
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value="none" disabled>
                                  No unassigned projects
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>

                          <Select
                            value={draft.role}
                            onValueChange={(role) =>
                              updateProjectAssignment(draft.draftId, { role })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose role" />
                            </SelectTrigger>
                            <SelectContent className="max-h-80">
                              {USER_ROLE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    })}
                  </div>

                  <Button
                    type="button"
                    onClick={handleAssignProjects}
                    disabled={
                      savingProjectAccess ||
                      !projectAssignments.some((assignment) => assignment.projectId)
                    }
                    size="sm"
                    className="w-full"
                  >
                    {savingProjectAccess ? "Assigning..." : "Assign Projects"}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Organizations</Label>
              <p className="text-sm text-muted-foreground">
                Member of {user.organizationCount} organization
                {user.organizationCount !== 1 ? "s" : ""}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="activity" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Badge variant={user.isActive ? "default" : "secondary"}>
                {user.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>

            <div className="space-y-2">
              <Label>Last Login</Label>
              <p className="text-sm text-muted-foreground">
                {user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleString()
                  : "Never"}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Created</Label>
              <p className="text-sm text-muted-foreground">
                {new Date(user.createdAt).toLocaleString()}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Last Updated</Label>
              <p className="text-sm text-muted-foreground">
                {new Date(user.updatedAt).toLocaleString()}
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
