"use client"

import * as React from "react"
import { IconMail, IconUser, IconX } from "@tabler/icons-react"
import { toast } from "sonner"

import type { UserWithRelations } from "@/app/actions/users"
import { updateUserRole } from "@/app/actions/users"
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
}

export function UserDrawer({
  user,
  open,
  onOpenChange,
  onUserUpdated,
}: UserDrawerProps) {
  const [saving, setSaving] = React.useState(false)
  const [selectedRole, setSelectedRole] = React.useState<string>("office")

  React.useEffect(() => {
    if (user) {
      setSelectedRole(user.role)
    }
  }, [user])

  if (!user) return null

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
            View and manage user details, roles, and permissions
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="profile" className="mt-6">
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
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger id="role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="office">Office</SelectItem>
                  <SelectItem value="field">Field</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                </SelectContent>
              </Select>
              {selectedRole !== user.role && (
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
              <p className="text-sm text-muted-foreground">
                Assigned to {user.projectCount} project
                {user.projectCount !== 1 ? "s" : ""}
              </p>
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
