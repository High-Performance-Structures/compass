"use client"

import * as React from "react"
import { IconLoader } from "@tabler/icons-react"
import { toast } from "sonner"

import { inviteUser } from "@/app/actions/users"
import { getOrganizations } from "@/app/actions/organizations"
import type { Organization } from "@/db/schema"
import { USER_ROLE_OPTIONS, userRoleDescription } from "@/lib/user-roles"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUserInvited?: () => void | Promise<void>
}

export function InviteDialog({
  open,
  onOpenChange,
  onUserInvited,
}: InviteDialogProps) {
  const [displayName, setDisplayName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState("office")
  const [organizationId, setOrganizationId] = React.useState<string>("none")
  const [organizations, setOrganizations] = React.useState<Organization[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadingOrgs, setLoadingOrgs] = React.useState(true)

  React.useEffect(() => {
    if (open) {
      loadOrganizations()
    }
  }, [open])

  const loadOrganizations = async () => {
    try {
      const orgs = await getOrganizations()
      setOrganizations(orgs)
    } catch (error) {
      console.error("Failed to load organizations:", error)
    } finally {
      setLoadingOrgs(false)
    }
  }

  const handleInvite = async () => {
    if (!displayName.trim()) {
      toast.error("Please enter the user's name")
      return
    }

    if (!email) {
      toast.error("Please enter an email address")
      return
    }

    if (!email.includes("@")) {
      toast.error("Please enter a valid email address")
      return
    }

    setLoading(true)
    try {
      const result = await inviteUser({
        displayName,
        email,
        role,
        organizationId:
          organizationId === "none" ? undefined : organizationId,
      })
      if (result.success) {
        toast.success(
          result.accessStatus === "invited"
            ? "Invitation sent — pending acceptance"
            : "Existing user added to the team"
        )
        await onUserInvited?.()
        onOpenChange(false)
        // reset form
        setDisplayName("")
        setEmail("")
        setRole("office")
        setOrganizationId("none")
      } else {
        toast.error(result.error || "Failed to invite user")
      }
    } catch {
      toast.error("Failed to invite user")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>
            Send an invitation to join your organization. They will receive an
            email with instructions to set up their account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="display-name">Name *</Label>
            <Input
              id="display-name"
              placeholder="Stanley Platt"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email Address *</Label>
            <Input
              id="email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role *</Label>
            <Select value={role} onValueChange={setRole} disabled={loading}>
              <SelectTrigger id="role">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {userRoleDescription(role)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="organization">Organization (Optional)</Label>
            {loadingOrgs ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader className="size-4 animate-spin" />
                Loading organizations...
              </div>
            ) : (
              <>
                <SearchableCombobox
                  id="organization"
                  ariaLabel="Choose organization"
                  options={[
                    { value: "none", label: "None" },
                    ...organizations.map((organization) => ({
                      value: organization.id,
                      label: organization.name,
                      description: organization.type,
                    })),
                  ]}
                  value={organizationId}
                  onValueChange={setOrganizationId}
                  disabled={loading}
                  placeholder="Select organization"
                  searchPlaceholder="Search organizations..."
                  emptyMessage="No matching organizations."
                  groupHeading="Organizations"
                />
                <p className="text-xs text-muted-foreground">
                  Assign the user to an organization upon invitation
                </p>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={loading}>
            {loading ? (
              <>
                <IconLoader className="mr-2 size-4 animate-spin" />
                Inviting...
              </>
            ) : (
              "Send Invitation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
