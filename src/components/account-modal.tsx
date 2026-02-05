"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Separator } from "@/components/ui/separator"
import { getInitials } from "@/lib/utils"
import { updateProfile, changePassword } from "@/app/actions/profile"
import type { SidebarUser } from "@/lib/auth"

type AccountModalProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly user: SidebarUser | null
}

export function AccountModal({ open, onOpenChange, user }: AccountModalProps) {
  const router = useRouter()

  // Profile form state
  const [firstName, setFirstName] = React.useState("")
  const [lastName, setLastName] = React.useState("")
  const [isSavingProfile, setIsSavingProfile] = React.useState(false)

  // Password form state
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [isChangingPassword, setIsChangingPassword] = React.useState(false)

  // Initialize form when user changes or modal opens
  React.useEffect(() => {
    if (user && open) {
      setFirstName(user.firstName ?? "")
      setLastName(user.lastName ?? "")
      // Clear password fields when opening
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    }
  }, [user, open])

  if (!user) {
    return null
  }

  const initials = getInitials(user.name)

  async function handleSaveProfile() {
    setIsSavingProfile(true)
    try {
      const result = await updateProfile({ firstName, lastName })
      if (result.success) {
        toast.success("Profile updated")
        router.refresh() // Refresh to show updated data
        onOpenChange(false)
      } else {
        toast.error(result.error)
      }
    } catch {
      toast.error("Failed to update profile")
    } finally {
      setIsSavingProfile(false)
    }
  }

  async function handleChangePassword() {
    // Client-side validation
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }

    setIsChangingPassword(true)
    try {
      const result = await changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      })
      if (result.success) {
        toast.success("Password updated")
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
      } else {
        toast.error(result.error)
      }
    } catch {
      toast.error("Failed to change password")
    } finally {
      setIsChangingPassword(false)
    }
  }

  const hasProfileChanges =
    firstName !== (user.firstName ?? "") || lastName !== (user.lastName ?? "")

  const canChangePassword =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    confirmPassword.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">Account Settings</DialogTitle>
          <DialogDescription className="text-xs">
            Manage your profile and security settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
              <AvatarFallback className="text-sm">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-muted-foreground text-xs truncate">{user.email}</p>
            </div>
          </div>

          <Separator className="my-3" />

          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Profile</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName" className="text-xs">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="h-9"
                  disabled={isSavingProfile}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName" className="text-xs">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="h-9"
                  disabled={isSavingProfile}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                className="h-9 bg-muted text-muted-foreground"
                disabled
                readOnly
              />
              <p className="text-xs text-muted-foreground">
                Contact support to change your email address.
              </p>
            </div>
          </div>

          <Separator className="my-3" />

          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Change Password</h4>
            <div className="space-y-1.5">
              <Label htmlFor="current-password" className="text-xs">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="h-9"
                disabled={isChangingPassword}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-xs">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="h-9"
                disabled={isChangingPassword}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-xs">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="h-9"
                disabled={isChangingPassword}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleChangePassword}
              disabled={!canChangePassword || isChangingPassword}
            >
              {isChangingPassword ? "Changing..." : "Change Password"}
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 sm:flex-initial h-9 text-sm"
            disabled={isSavingProfile}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveProfile}
            className="flex-1 sm:flex-initial h-9 text-sm"
            disabled={!hasProfileChanges || isSavingProfile}
          >
            {isSavingProfile ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
