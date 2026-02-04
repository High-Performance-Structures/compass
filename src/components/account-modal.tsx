"use client"

import * as React from "react"
import { IconCamera } from "@tabler/icons-react"

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

export function AccountModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = React.useState("Martine Vogel")
  const [email, setEmail] = React.useState("martine@compass.io")
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")

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
            <div className="relative">
              <Avatar className="size-12">
                <AvatarImage src="/avatars/martine.jpg" alt={name} />
                <AvatarFallback className="text-sm">MV</AvatarFallback>
              </Avatar>
              <button className="bg-primary text-primary-foreground absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full">
                <IconCamera className="size-3" />
              </button>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{name}</p>
              <p className="text-muted-foreground text-xs truncate">{email}</p>
            </div>
          </div>

          <Separator className="my-3" />

          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Profile</h4>
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9"
              />
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
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-initial h-9 text-sm">
            Cancel
          </Button>
          <Button onClick={() => onOpenChange(false)} className="flex-1 sm:flex-initial h-9 text-sm">
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
