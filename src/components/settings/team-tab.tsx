"use client"

import * as React from "react"
import { IconUserPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { getUsers, deactivateUser, type UserWithRelations } from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { PeopleTable } from "@/components/people-table"
import { UserDrawer } from "@/components/people/user-drawer"
import { InviteDialog } from "@/components/people/invite-dialog"

export function TeamTab() {
  const [users, setUsers] = React.useState<UserWithRelations[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedUser, setSelectedUser] = React.useState<UserWithRelations | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false)

  React.useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      const data = await getUsers()
      setUsers(data)
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
    try {
      const result = await deactivateUser(userId)
      if (result.success) {
        toast.success("User deactivated")
        await loadUsers()
      } else {
        toast.error(result.error || "Failed to deactivate user")
      }
    } catch (error) {
      console.error("Failed to deactivate user:", error)
      toast.error("Failed to deactivate user")
    }
  }

  const handleUserUpdated = async () => {
    await loadUsers()
  }

  const handleUserInvited = async () => {
    await loadUsers()
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
            Manage team members and client users
          </p>
          <Button
            onClick={() => setInviteDialogOpen(true)}
            size="sm"
          >
            <IconUserPlus className="mr-2 size-4" />
            Invite User
          </Button>
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
          />
        )}
      </div>

      <UserDrawer
        user={selectedUser}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onUserUpdated={handleUserUpdated}
      />

      <InviteDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        onUserInvited={handleUserInvited}
      />
    </>
  )
}
