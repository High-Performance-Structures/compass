"use client"

import * as React from "react"
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react"
import { RtkMeeting } from "@cloudflare/realtimekit-react-ui"
import type { UIConfig } from "@cloudflare/realtimekit-react-ui"
import { sendMessage } from "@/app/actions/chat-messages"
import { joinRealtimeKitVoiceSession } from "@/app/actions/voice-sessions"

type TranscriptEntry = {
  readonly id: string
  readonly name: string
  readonly transcript: string
  readonly isPartialTranscript: boolean
  readonly date: Date
}

type VideoBackgroundAddonHandle = {
  readonly unregister: () => void | Promise<void>
}

const MEETING_BACKGROUND_IMAGES = [
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900'%3E%3Cdefs%3E%3ClinearGradient id='a' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%2320170f'/%3E%3Cstop offset='.46' stop-color='%234f2f13'/%3E%3Cstop offset='1' stop-color='%233f7d4d'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill='url(%23a)' width='1600' height='900'/%3E%3Ccircle cx='1320' cy='160' r='260' fill='%23ffffff' opacity='.12'/%3E%3Cpath d='M0 760 C360 620 580 820 900 680 C1170 562 1320 620 1600 470 L1600 900 L0 900 Z' fill='%230b120d' opacity='.45'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900'%3E%3Cdefs%3E%3ClinearGradient id='b' x1='0' x2='1'%3E%3Cstop stop-color='%230f172a'/%3E%3Cstop offset='.52' stop-color='%233f7d4d'/%3E%3Cstop offset='1' stop-color='%239c7426'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill='url(%23b)' width='1600' height='900'/%3E%3Cpath d='M160 710 L520 350 L840 700 L1050 480 L1450 720 Z' fill='%23ffffff' opacity='.15'/%3E%3Cpath d='M0 720 H1600 V900 H0 Z' fill='%23050505' opacity='.38'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900'%3E%3Crect fill='%230f1a13' width='1600' height='900'/%3E%3Cpath d='M0 130 H1600' stroke='%233f7d4d' stroke-width='4' opacity='.35'/%3E%3Cpath d='M0 300 H1600M0 470 H1600M0 640 H1600' stroke='%23ffffff' stroke-width='2' opacity='.12'/%3E%3Cpath d='M280 0 V900M620 0 V900M960 0 V900M1300 0 V900' stroke='%23ffffff' stroke-width='2' opacity='.10'/%3E%3Ccircle cx='1250' cy='220' r='150' fill='%239c7426' opacity='.30'/%3E%3C/svg%3E",
]

const COMPASS_MEETING_BASE_CONFIG: UIConfig = {
  designTokens: {
    theme: "dark",
    borderRadius: "rounded",
    colors: {
      brand: {
        300: "#9bd3a8",
        400: "#63b878",
        500: "#3f7d4d",
        600: "#32663e",
        700: "#244d2d",
      },
      background: {
        1000: "#08110b",
        900: "#0e1a12",
        800: "#142419",
        700: "#203626",
        600: "#2d4a34",
      },
      text: "#f8fafc",
      "text-on-brand": "#ffffff",
      danger: "#ef4444",
      success: "#22c55e",
      warning: "#f59e0b",
      "video-bg": "#050805",
    },
  },
  config: {
    videoFit: "contain",
    notification_sounds: {
      participant_joined: false,
      participant_left: false,
    },
  },
  styles: {
    "rtk-controlbar": {
      backgroundColor: "rgba(8, 17, 11, 0.92)",
      border: "1px solid rgba(255, 255, 255, 0.18)",
      boxShadow: "0 18px 50px rgba(0, 0, 0, 0.42)",
    },
    "rtk-controlbar-button": {
      color: "#f8fafc",
    },
    "rtk-more-toggle": {
      color: "#f8fafc",
    },
    "rtk-settings-toggle": {
      color: "#f8fafc",
    },
  },
}

function transcriptKey(entry: TranscriptEntry): string {
  return entry.id.length > 0
    ? entry.id
    : `${entry.name}-${entry.date.toISOString()}-${entry.transcript}`
}

function mergeTranscript(
  current: readonly TranscriptEntry[],
  entry: TranscriptEntry
): readonly TranscriptEntry[] {
  const key = transcriptKey(entry)
  const next = current.filter((item) => transcriptKey(item) !== key)
  return [...next, entry].sort((a, b) => a.date.getTime() - b.date.getTime())
}

function transcriptText(entries: readonly TranscriptEntry[]): string {
  return entries
    .filter((entry) => !entry.isPartialTranscript)
    .map((entry) => {
      const time = entry.date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
      return `[${time}] ${entry.name}: ${entry.transcript}`
    })
    .join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function linesToHtml(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(escapeHtml)
    .join("<br>")
}

export function RealtimeKitMeetingWindow({
  channelId,
}: {
  readonly channelId: string
}): React.ReactElement {
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = React.useState("Compass Talk")
  const [meetingConfig, setMeetingConfig] = React.useState<UIConfig>(
    COMPASS_MEETING_BASE_CONFIG
  )
  const [notes, setNotes] = React.useState("")
  const [notesStatus, setNotesStatus] = React.useState<string | null>(null)
  const [activePanel, setActivePanel] = React.useState<"notes" | "transcript">(
    "notes"
  )
  const [transcripts, setTranscripts] = React.useState<readonly TranscriptEntry[]>(
    []
  )
  const addonRef = React.useRef<VideoBackgroundAddonHandle | null>(null)

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
      const initializedMeeting = await initMeeting({
        authToken: result.data.authToken,
        defaults: {
          audio: true,
          video: true,
        },
      })
      if (!initializedMeeting) {
        setError("Cloudflare meeting did not initialize.")
        setLoading(false)
        return
      }
      if (!initializedMeeting.self.roomJoined) {
        await initializedMeeting.join()
      }
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

  React.useEffect(() => {
    if (!meeting) return

    let isCurrent = true
    void (async () => {
      const [{ default: VideoBackgroundAddon }, { registerAddons }] =
        await Promise.all([
          import("@cloudflare/realtimekit-ui-addons/video-background"),
          import("@cloudflare/realtimekit-ui"),
        ])
      if (!isCurrent) return

      const backgroundAddon = await VideoBackgroundAddon.init({
        meeting,
        modes: ["blur", "virtual", "random", "none"],
        randomCount: 3,
        blurStrength: 45,
        buttonLabel: "Background",
        images: MEETING_BACKGROUND_IMAGES,
      })
      if (!isCurrent) {
        await backgroundAddon.unregister()
        return
      }

      addonRef.current = backgroundAddon
      setMeetingConfig(
        registerAddons(
          [backgroundAddon],
          meeting,
          COMPASS_MEETING_BASE_CONFIG
        )
      )
    })().catch(() => undefined)

    return () => {
      isCurrent = false
      const addon = addonRef.current
      addonRef.current = null
      if (addon) void addon.unregister()
      setMeetingConfig(COMPASS_MEETING_BASE_CONFIG)
    }
  }, [meeting])

  React.useEffect(() => {
    if (!meeting) return
    const handleTranscript = (entry: TranscriptEntry): void => {
      setTranscripts((current) => mergeTranscript(current, entry))
    }
    meeting.ai.on("transcript", handleTranscript)
    setTranscripts([...meeting.ai.transcripts])
    void meeting.ai.getActiveTranscript().catch(() => undefined)
    return () => {
      meeting.ai.off("transcript", handleTranscript)
    }
  }, [meeting])

  const savedTranscriptText = React.useMemo(
    () => transcriptText(transcripts),
    [transcripts]
  )

  const saveMeetingNotes = React.useCallback(async (): Promise<void> => {
    const trimmed = notes.trim()
    if (trimmed.length === 0) {
      setNotesStatus("Add a note before saving.")
      return
    }

    setNotesStatus("Saving notes...")
    const result = await sendMessage({
      channelId,
      content: `### Meeting notes\n\n${trimmed}`,
      contentHtml: `<section><h3>Meeting notes</h3><p>${linesToHtml(trimmed)}</p></section>`,
    })
    setNotesStatus(
      result.success
        ? "Saved to this conversation."
        : result.error ?? "Failed to save notes."
    )
  }, [channelId, notes])

  const saveTranscript = React.useCallback(async (): Promise<void> => {
    if (savedTranscriptText.length === 0) {
      setNotesStatus("No finalized transcript lines to save yet.")
      return
    }

    setNotesStatus("Saving transcript...")
    const result = await sendMessage({
      channelId,
      content: `### Meeting transcript\n\n${savedTranscriptText}`,
      contentHtml: `<section><h3>Meeting transcript</h3><pre>${escapeHtml(savedTranscriptText)}</pre></section>`,
    })
    setNotesStatus(
      result.success
        ? "Transcript saved to this conversation."
        : result.error ?? "Failed to save transcript."
    )
  }, [channelId, savedTranscriptText])

  return (
    <main
      data-compass-meeting
      className="flex h-dvh min-h-dvh flex-col bg-slate-950 text-white"
    >
      <style>
        {`
          [data-compass-meeting] {
            --rtk-colors-text: 248 250 252;
            --rtk-colors-text-1000: 248 250 252;
            --rtk-colors-text-900: 226 232 240;
            --rtk-colors-brand-500: 63 125 77;
            --rtk-colors-background-1000: 8 17 11;
            --rtk-colors-background-900: 14 26 18;
          }
          [data-compass-meeting] rtk-controlbar-button,
          [data-compass-meeting] rtk-mic-toggle,
          [data-compass-meeting] rtk-camera-toggle,
          [data-compass-meeting] rtk-screen-share-toggle,
          [data-compass-meeting] rtk-settings-toggle,
          [data-compass-meeting] rtk-more-toggle,
          [data-compass-meeting] rtk-chat-toggle,
          [data-compass-meeting] rtk-participants-toggle,
          [data-compass-meeting] rtk-polls-toggle,
          [data-compass-meeting] rtk-ai-toggle {
            color: #f8fafc;
          }
        `}
      </style>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{meetingTitle}</h1>
          <p className="text-xs text-white/55">
            Compass meeting with notes, transcript, and background effects
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.close()}
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
        >
          Close Window
        </button>
      </header>
      <section className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/70">
            Opening secure meeting...
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-200">
            {error}
          </div>
        ) : (
          <RtkMeeting
            meeting={meeting}
            config={meetingConfig}
            applyDesignSystem
            leaveOnUnmount
            loadConfigFromPreset={false}
            showSetupScreen={false}
          />
        )}
        <aside className="min-h-0 border-t border-white/10 bg-[#08110b] xl:border-l xl:border-t-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 border-b border-white/10 p-2">
              <button
                type="button"
                onClick={() => setActivePanel("notes")}
                className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                  activePanel === "notes"
                    ? "bg-[#3f7d4d] text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                Notes
              </button>
              <button
                type="button"
                onClick={() => setActivePanel("transcript")}
                className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                  activePanel === "transcript"
                    ? "bg-[#3f7d4d] text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                Transcript
              </button>
            </div>
            {activePanel === "notes" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.currentTarget.value)}
                  placeholder="Meeting notes..."
                  className="min-h-0 flex-1 resize-none rounded-sm border border-white/15 bg-white/5 p-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[#63b878]"
                />
                <button
                  type="button"
                  onClick={() => void saveMeetingNotes()}
                  className="rounded-sm bg-[#3f7d4d] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4f9860]"
                >
                  Save Notes to Conversation
                </button>
                {notesStatus ? (
                  <p className="text-xs text-white/55">{notesStatus}</p>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {transcripts.length === 0 ? (
                    <p className="rounded-sm border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                      No transcript lines yet. If this stays empty during a
                      live call, the RealtimeKit preset may still need
                      transcription enabled in Cloudflare.
                    </p>
                  ) : (
                    transcripts.map((entry) => (
                      <div
                        key={transcriptKey(entry)}
                        className={`rounded-sm border p-2 text-sm ${
                          entry.isPartialTranscript
                            ? "border-white/10 bg-white/5 text-white/55"
                            : "border-[#3f7d4d]/50 bg-[#3f7d4d]/10 text-white"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-white/45">
                          <span className="truncate font-medium">{entry.name}</span>
                          <span>
                            {entry.date.toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p>{entry.transcript}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="shrink-0 border-t border-white/10 p-3">
                  <button
                    type="button"
                    onClick={() => void saveTranscript()}
                    className="w-full rounded-sm bg-[#3f7d4d] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4f9860]"
                  >
                    Save Transcript to Conversation
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  )
}
