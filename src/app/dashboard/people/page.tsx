"use client"

import * as React from "react"
import { IconUserPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { getUsers, deactivateUser, type UserWithRelations } from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { PeopleTable } from "@/components/people-table"
import { UserDrawer } from "@/components/people/user-drawer"
import { InviteDialog } from "@/components/people/invite-dialog"


export default function PeoplePage() {
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
      <div className="flex-1 space-y-4 p-4 sm:p-6 md:p-8 pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">People</h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Manage team members and client users
            </p>
          </div>
        </div>
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          Loading...
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 space-y-4 p-4 sm:p-6 md:p-8 pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">People</h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Manage team members and client users
            </p>
          </div>
          <Button
            onClick={() => setInviteDialogOpen(true)}
            className="w-full sm:w-auto"
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
