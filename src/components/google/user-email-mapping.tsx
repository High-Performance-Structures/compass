"use client"

import { useState } from "react"
import { IconLoader2, IconMail } from "@tabler/icons-react"

import { updateUserGoogleEmail } from "@/app/actions/google-drive"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

export function UserEmailMapping({
  userId,
  currentEmail,
  googleEmail,
}: {
  userId: string
  currentEmail: string
  googleEmail: string | null
}) {
  const [email, setEmail] = useState(googleEmail ?? "")
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    setLoading(true)
    const value = email.trim() || null
    const result = await updateUserGoogleEmail(userId, value)
    if (result.success) {
      toast.success(
        value
          ? `Google email set to ${value}`
          : "Google email override removed"
      )
    } else {
      toast.error(result.error)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <IconMail size={16} className="text-muted-foreground" />
        <Label className="text-xs font-medium">
          Google Workspace Email Override
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Default: {currentEmail}. Set a different email if
        your Google Workspace account uses a different
        address.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Leave empty to use default email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="h-8 text-sm"
          disabled={loading}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={loading}
        >
          {loading && (
            <IconLoader2
              size={14}
              className="mr-1 animate-spin"
            />
          )}
          Save
        </Button>
      </div>
    </div>
  )
}
