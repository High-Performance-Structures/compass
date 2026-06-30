"use client"

import * as React from "react"
import { IconUserPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getUsers,
  deactivateUser,
  getUserManagementContext,
  type UserManagementContext,
  type UserWithRelations,
} from "@/app/actions/users"
import { getProjects, type ProjectListItem } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { PeopleTable } from "@/components/people-table"
import { UserDrawer } from "@/components/people/user-drawer"
import { InviteDialog } from "@/components/people/invite-dialog"
import { InviteLinksSection } from "@/components/settings/invite-links-section"

export function TeamTab() {
  const [users, setUsers] = React.useState<UserWithRelations[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedUser, setSelectedUser] = React.useState<UserWithRelations | null>(null)
  const [projects, setProjects] = React.useState<ProjectListItem[]>([])
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false)
  const [context, setContext] = React.useState<UserManagementContext>({
    currentUserId: null,
    role: null,
    canManageUsers: false,
  })

  React.useEffect(() => {
    loadTeam()
  }, [])

  const loadTeam = async () => {
    setLoading(true)
    try {
      const [data, accessContext] = await Promise.all([
        getUsers(),
        getUserManagementContext(),
      ])
      const projectData = accessContext.canManageUsers ? await getProjects() : []
      setUsers(data)
      setProjects(projectData)
      setContext(accessContext)
      setSelectedUser((current) => {
        if (!current) return current
        return data.find((user) => user.id === current.id) ?? current
      })
    } catch (error) {
      console.error("Failed to load users:", error)
      toast.error("Failed to load users")
    } finally {
      setLoading(false)
    }
  }

  const handleEditUser = (user: UserWithRelations) => {
    setSelectedUser(user)
    setDrawerOpen(true)
  }

  const handleDeactivateUser = async (userId: string) => {
    if (!context.canManageUsers) {
      toast.error("Only admins can deactivate users")
      return
    }

    try {
      const result = await deactivateUser(userId)
      if (result.success) {
        toast.success("User deactivated")
        await loadTeam()
      } else {
        toast.error(result.error || "Failed to deactivate user")
      }
    } catch (error) {
      console.error("Failed to deactivate user:", error)
      toast.error("Failed to deactivate user")
    }
  }

  const handleUserUpdated = async () => {
    await loadTeam()
  }

  const handleUserInvited = async () => {
    await loadTeam()
  }

  if (loading) {
    return (
      <div className="rounded-md border p-8 text-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {context.canManageUsers
              ? "Manage users, roles, and invite access"
              : "Staff directory. Role changes and deactivation are admin-only."}
          </p>
          {context.canManageUsers && (
            <Button
              onClick={() => setInviteDialogOpen(true)}
              size="sm"
            >
              <IconUserPlus className="mr-2 size-4" />
              Invite User
            </Button>
          )}
        </div>

        {users.length === 0 ? (
          <div className="rounded-md border p-8 text-center text-muted-foreground">
            <p>No users found</p>
            <p className="text-sm mt-2">
              Invite users to get started
            </p>
          </div>
        ) : (
          <PeopleTable
            users={users}
            onEditUser={handleEditUser}
            onDeactivateUser={handleDeactivateUser}
            canManageUsers={context.canManageUsers}
          />
        )}
      </div>

      {context.canManageUsers && (
        <>
          <Separator className="my-6" />
          <InviteLinksSection />
        </>
      )}

      <UserDrawer
        user={selectedUser}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onUserUpdated={handleUserUpdated}
        canManageUsers={context.canManageUsers}
        projects={projects}
      />

      <InviteDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        onUserInvited={handleUserInvited}
      />
    </>
  )
}
