"use client"

import * as React from "react"
import { IconUserPlus } from "@tabler/icons-react"
import Link from "next/link"
import { toast } from "sonner"

import {
  getSettingsUsers,
  deactivateUser,
  inviteUser,
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
  parseTeamAccessSection,
  teamAccessSectionForRole,
  type TeamAccessSection,
} from "@/lib/team-access-section"

const SECTION_OPTIONS = [
  { value: "internal", label: "Internal Team", description: "Staff accounts and invitations" },
  { value: "vendors", label: "Vendors", description: "Subcontractor and supplier access" },
  { value: "clients", label: "Clients", description: "Owner and client access" },
  { value: "other", label: "Other Access", description: "Guest and developer accounts" },
] as const

const CONTACT_TAB: Record<Exclude<TeamAccessSection, "other">, string> = {
  internal: "internal",
  vendors: "vendors",
  clients: "customers",
}

export function TeamTab() {
  const [users, setUsers] = React.useState<UserWithRelations[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedUser, setSelectedUser] = React.useState<UserWithRelations | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false)
  const [section, setSection] = React.useState<TeamAccessSection>("internal")

  React.useEffect(() => {
    loadUsers()
    setSection(parseTeamAccessSection(new URLSearchParams(window.location.search).get("view")))
  }, [])

  const handleSectionChange = (value: string) => {
    const nextSection = parseTeamAccessSection(value)
    setSection(nextSection)
    const url = new URL(window.location.href)
    url.searchParams.set("section", "team")
    url.searchParams.set("view", nextSection)
    window.history.replaceState(window.history.state, "", url)
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
          {section !== "other" && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/contacts?tab=${CONTACT_TAB[section]}`}>
                View {sectionLabel} contacts
              </Link>
            </Button>
          )}
        </div>
        {section === "other" && (
          <p className="text-xs text-muted-foreground">
            Guest and developer accounts stay separate until they have an explicit directory relationship.
          </p>
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
            key={section}
            users={sectionUsers}
            onEditUser={handleEditUser}
            onDeactivateUser={handleDeactivateUser}
            onReinviteUser={handleReinviteUser}
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
    </>
  )
}
