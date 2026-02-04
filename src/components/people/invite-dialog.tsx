"use client"

import * as React from "react"
import { IconLoader } from "@tabler/icons-react"
import { toast } from "sonner"

import { inviteUser } from "@/app/actions/users"
import { getOrganizations } from "@/app/actions/organizations"
import type { Organization } from "@/db/schema"
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
  onUserInvited?: () => void
}

export function InviteDialog({
  open,
  onOpenChange,
  onUserInvited,
}: InviteDialogProps) {
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
      const result = await inviteUser(
        email,
        role,
        organizationId === "none" ? undefined : organizationId
      )
      if (result.success) {
        toast.success("User invited successfully")
        onUserInvited?.()
        onOpenChange(false)
        // reset form
        setEmail("")
        setRole("office")
        setOrganizationId("none")
      } else {
        toast.error(result.error || "Failed to invite user")
      }
    } catch (error) {
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
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="office">Office</SelectItem>
                <SelectItem value="field">Field</SelectItem>
                <SelectItem value="client">Client</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {role === "admin" &&
                "Full access to all features and settings"}
              {role === "office" &&
                "Can manage projects, schedules, and documents"}
              {role === "field" &&
                "Can update schedules and create documents"}
              {role === "client" && "Read-only access to assigned projects"}
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
                <Select
                  value={organizationId}
                  onValueChange={setOrganizationId}
                  disabled={loading}
                >
                  <SelectTrigger id="organization">
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name} ({org.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
