"use client"

import { useState, useEffect } from "react"
import {
  IconBrandGoogleDrive,
  IconCheck,
  IconX,
  IconLoader2,
} from "@tabler/icons-react"

import {
  getGoogleDriveConnectionStatus,
  disconnectGoogleDrive,
} from "@/app/actions/google-drive"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { GoogleConnectDialog } from "./connect-dialog"
import { SharedDrivePicker } from "./shared-drive-picker"

export function GoogleDriveConnectionStatus() {
  const [status, setStatus] = useState<{
    connected: boolean
    workspaceDomain: string | null
    sharedDriveName: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectOpen, setConnectOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const fetchStatus = async () => {
    setLoading(true)
    const result = await getGoogleDriveConnectionStatus()
    setStatus(result)
    setLoading(false)
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    const result = await disconnectGoogleDrive()
    if (result.success) {
      toast.success("Google Drive disconnected")
      await fetchStatus()
    } else {
      toast.error(result.error)
    }
    setDisconnecting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-4">
        <IconLoader2
          size={20}
          className="animate-spin text-muted-foreground"
        />
        <span className="text-sm text-muted-foreground">
          Checking Google Drive connection...
        </span>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <IconBrandGoogleDrive size={20} />
            <span className="text-sm font-medium">
              Google Drive
            </span>
            {status?.connected ? (
              <Badge
                variant="outline"
                className="gap-1 text-green-600 border-green-200"
              >
                <IconCheck size={12} />
                Connected
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 text-muted-foreground"
              >
                <IconX size={12} />
                Not connected
              </Badge>
            )}
          </div>
        </div>

        {status?.connected && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Domain: {status.workspaceDomain}</p>
            {status.sharedDriveName && (
              <p>Shared drive: {status.sharedDriveName}</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {status?.connected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
              >
                Change shared drive
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting
                  ? "Disconnecting..."
                  : "Disconnect"}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => setConnectOpen(true)}
            >
              Connect Google Drive
            </Button>
          )}
        </div>
      </div>

      <GoogleConnectDialog
        open={connectOpen}
        onOpenChange={open => {
          setConnectOpen(open)
          if (!open) fetchStatus()
        }}
      />
      <SharedDrivePicker
        open={pickerOpen}
        onOpenChange={open => {
          setPickerOpen(open)
          if (!open) fetchStatus()
        }}
      />
    </>
  )
}
