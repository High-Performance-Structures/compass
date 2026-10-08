"use client"

import * as React from "react"
import { IconUserPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getSettingsUsers,
  deactivateUser,
  inviteUser,
  getAssignableContactProjects,
  grantContactsProjectAccess,
  type UserWithRelations,
} from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { PeopleTable } from "@/components/people-table"
import { UserDrawer } from "@/components/people/user-drawer"
import { InviteDialog } from "@/components/people/invite-dialog"
import { InviteLinksSection } from "@/components/settings/invite-links-section"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  teamAccessSectionForRole,
  type TeamAccessSection,
} from "@/lib/team-access-section"

const SECTION_OPTIONS = [
  { value: "internal", label: "Internal Team", description: "Staff accounts and invitations" },
  { value: "vendors", label: "Vendors", description: "Subcontractor and supplier access" },
  { value: "clients", label: "Clients", description: "Owner and client access" },
  { value: "other", label: "Other Access", description: "Guest and developer accounts" },
] as const

export function TeamTab({ initialSection }: { readonly initialSection: TeamAccessSection }) {
  const [users, setUsers] = React.useState<UserWithRelations[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedUser, setSelectedUser] = React.useState<UserWithRelations | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false)
  const [section, setSection] = React.useState<TeamAccessSection>(initialSection)
  const [selectedUserIds, setSelectedUserIds] = React.useState<readonly string[]>([])
  const [selectionEpoch, setSelectionEpoch] = React.useState(0)
  const [projects, setProjects] = React.useState<readonly { readonly id: string; readonly name: string; readonly projectNumber: string | null }[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const [grantDialogOpen, setGrantDialogOpen] = React.useState(false)
  const [granting, setGranting] = React.useState(false)

  React.useEffect(() => {
    loadUsers()
    void getAssignableContactProjects().then(setProjects).catch(() => toast.error("Failed to load projects"))
  }, [])

  const handleSectionChange = (value: string) => {
    const nextSection = SECTION_OPTIONS.find((option) => option.value === value)?.value ?? "internal"
    setSection(nextSection)
    setSelectedUserIds([])
  }

  const sectionUsers = users.filter((user) => teamAccessSectionForRole(user.role) === section)
  const sectionLabel = SECTION_OPTIONS.find((option) => option.value === section)?.label ?? "Internal Team"

  const loadUsers = async () => {
    try {
      const data = await getSettingsUsers()
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

  const handleReinviteUser = async (user: UserWithRelations) => {
    try {
      const result = await inviteUser({
        displayName: user.displayName ?? undefined,
        email: user.email,
        role: user.role,
      })
      if (result.success) {
        toast.success("Invitation sent again")
        await loadUsers()
      } else {
        toast.error(result.error || "Failed to resend invitation")
      }
    } catch (error) {
      console.error("Failed to resend invitation:", error)
      toast.error("Failed to resend invitation")
    }
  }

  const handleUserUpdated = async () => {
    await loadUsers()
  }

  const handleUserInvited = async () => {
    await loadUsers()
  }

  const handleGrantProjectAccess = async () => {
    if (!selectedProjectId || selectedUserIds.length === 0) return
    setGranting(true)
    try {
      const result = await grantContactsProjectAccess(selectedUserIds, selectedProjectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        `${result.added} account${result.added === 1 ? "" : "s"} granted project access${result.existing > 0 ? `; ${result.existing} already had access` : ""}`
      )
      setGrantDialogOpen(false)
      setSelectedUserIds([])
      setSelectionEpoch((current) => current + 1)
      await loadUsers()
    } finally {
      setGranting(false)
    }
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              Manage Compass accounts, roles, and invitations. Contact details live in the shared directories.
            </p>
          </div>
          <Button
            onClick={() => setInviteDialogOpen(true)}
            size="sm"
          >
            <IconUserPlus className="mr-2 size-4" />
            Invite User
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SearchableCombobox
            ariaLabel="Choose account group"
            options={SECTION_OPTIONS.map((option) => ({
              ...option,
              selectedLabel: `${option.label} (${users.filter((user) => teamAccessSectionForRole(user.role) === option.value).length})`,
            }))}
            value={section}
            onValueChange={handleSectionChange}
            placeholder="Choose account group"
            searchPlaceholder="Find account group..."
            className="w-64"
          />
        </div>
        {section === "other" && (
          <p className="text-xs text-muted-foreground">
            Guest and developer accounts stay separate until they have an explicit directory relationship.
          </p>
        )}

        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <p className="text-sm text-muted-foreground">
              {selectedUserIds.length} account{selectedUserIds.length === 1 ? "" : "s"} selected
            </p>
            <SearchableCombobox
              ariaLabel="Choose project for selected accounts"
              options={projects.map((project) => ({
                value: project.id,
                label: project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name,
              }))}
              value={selectedProjectId}
              onValueChange={setSelectedProjectId}
              placeholder="Choose project..."
              searchPlaceholder="Search projects..."
              className="w-72"
            />
            <Button
              type="button"
              size="sm"
              disabled={selectedUserIds.length === 0 || !selectedProjectId}
              onClick={() => setGrantDialogOpen(true)}
            >
              Grant project access
            </Button>
          </div>
        )}

        {sectionUsers.length === 0 ? (
          <div className="rounded-md border p-8 text-center text-muted-foreground">
            <p>No {sectionLabel.toLowerCase()} accounts found</p>
            <p className="text-sm mt-2">
              Invite users to get started
            </p>
          </div>
        ) : (
          <PeopleTable
            key={`${section}-${selectionEpoch}`}
            users={sectionUsers}
            onEditUser={handleEditUser}
            onDeactivateUser={handleDeactivateUser}
            onReinviteUser={handleReinviteUser}
            onSelectionChange={setSelectedUserIds}
          />
        )}
      </div>

      <Separator className="my-6" />
      <InviteLinksSection />

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

      <AlertDialog open={grantDialogOpen} onOpenChange={setGrantDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant project access?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedUserIds.length} selected account{selectedUserIds.length === 1 ? "" : "s"} will gain access to {projects.find((project) => project.id === selectedProjectId)?.name ?? "the selected project"}. Existing assignments will not be changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={granting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={granting} onClick={(event) => {
              event.preventDefault()
              void handleGrantProjectAccess()
            }}>
              {granting ? "Granting..." : "Grant access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
