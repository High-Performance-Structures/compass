"use client"

import * as React from "react"
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react"
import { RtkMeeting } from "@cloudflare/realtimekit-react-ui"
import { joinRealtimeKitVoiceSession } from "@/app/actions/voice-sessions"

export function RealtimeKitMeetingWindow({
  channelId,
}: {
  readonly channelId: string
}): React.ReactElement {
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = React.useState("Compass Talk")

  React.useEffect(() => {
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
  }, [channelId, initMeeting])

  React.useEffect(() => {
    document.title = meetingTitle
  }, [meetingTitle])

  return (
    <main className="flex h-dvh min-h-dvh flex-col bg-slate-950 text-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{meetingTitle}</h1>
          <p className="text-xs text-white/55">Compass video meeting</p>
        </div>
        <button
          type="button"
          onClick={() => window.close()}
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
        >
          Close Window
        </button>
      </header>
      <section className="min-h-0 flex-1">
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
      </section>
    </main>
  )
}
