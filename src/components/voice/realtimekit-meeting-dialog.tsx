"use client"

import * as React from "react"
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react"
import { RtkMeeting } from "@cloudflare/realtimekit-react-ui"
import { joinRealtimeKitVoiceSession } from "@/app/actions/voice-sessions"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type RealtimeKitMeetingDialogProps = {
  readonly channelId: string | null
  readonly channelName: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function RealtimeKitMeetingDialog({
  channelId,
  channelName,
  open,
  onOpenChange,
}: RealtimeKitMeetingDialogProps): React.ReactElement {
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true })
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = React.useState(channelName)

  React.useEffect(() => {
    if (!open || !channelId) return

    let isCurrent = true
    setLoading(true)
    setError(null)
    void (async () => {
      const result = await joinRealtimeKitVoiceSession(channelId)
      if (!isCurrent) return
      if (!result.success) {
        setError(result.error)
        setLoading(false)
        return
      }
      setMeetingTitle(result.data.meetingTitle)
      await initMeeting({
        authToken: result.data.authToken,
        baseURI: "realtime.cloudflare.com",
        defaults: {
          audio: true,
          video: true,
        },
      })
      if (isCurrent) setLoading(false)
    })().catch((cause: unknown) => {
      if (!isCurrent) return
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to open the Cloudflare meeting"
      )
      setLoading(false)
    })

    return () => {
      isCurrent = false
    }
  }, [channelId, initMeeting, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90vh] max-w-[96vw] overflow-hidden p-0 sm:max-w-[1180px]">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="text-base font-semibold">
            {meetingTitle || channelName || "Compass Talk"}
          </DialogTitle>
        </DialogHeader>
        <div className="h-[calc(90vh-57px)] bg-slate-950">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-white/70">
              Opening secure meeting...
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-200">
              {error}
            </div>
          ) : (
            <RtkMeeting meeting={meeting} leaveOnUnmount />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
