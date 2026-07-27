"use client"

import * as React from "react"
import { IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"

import { createInvite } from "@/app/actions/invites"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const EXPIRY_PRESETS = [
  { label: "Never", value: "never" },
  { label: "1 hour", value: "1h" },
  { label: "1 day", value: "1d" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
] as const

function getExpiryDate(preset: string): string | undefined {
  const now = Date.now()
  switch (preset) {
    case "1h":
      return new Date(now + 60 * 60 * 1000).toISOString()
    case "1d":
      return new Date(now + 24 * 60 * 60 * 1000).toISOString()
    case "7d":
      return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()
    case "30d":
      return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
    default:
      return undefined
  }
}

interface CreateInviteDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onCreated: () => void
}

export function CreateInviteDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateInviteDialogProps) {
  const [role, setRole] = React.useState("office")
  const [maxUses, setMaxUses] = React.useState("")
  const [expiry, setExpiry] = React.useState("never")
  const [loading, setLoading] = React.useState(false)
  const [createdUrl, setCreatedUrl] = React.useState<string | null>(null)

  const handleCreate = async () => {
    setLoading(true)
    try {
      const result = await createInvite(
        role,
        maxUses ? parseInt(maxUses, 10) : undefined,
        getExpiryDate(expiry)
      )
      if (result.success && result.data) {
        const fullUrl = `${window.location.origin}${result.data.url}`
        setCreatedUrl(fullUrl)
        onCreated()
      } else {
        toast.error(result.error ?? "Failed to create invite")
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (createdUrl) {
      navigator.clipboard.writeText(createdUrl)
      toast.success("Invite link copied")
    }
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setCreatedUrl(null)
      setRole("office")
      setMaxUses("")
      setExpiry("never")
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {createdUrl ? "Invite Link Created" : "Create Invite Link"}
          </DialogTitle>
          <DialogDescription>
            {createdUrl
              ? "Share this link with people you want to invite."
              : "Create a shareable link for your organization."}
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={createdUrl}
                readOnly
                className="font-mono text-sm"
              />
              <Button size="icon" variant="outline" onClick={handleCopy}>
                <IconCopy className="size-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
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
              <Label>Max uses (optional)</Label>
              <Input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Expires</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {createdUrl ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? "Creating..." : "Create Link"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
