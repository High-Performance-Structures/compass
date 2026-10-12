"use client"

import * as React from "react"
import { X } from "lucide-react"
import type RTKMeeting from "@cloudflare/realtimekit"
import { Button } from "@/components/ui/button"
import { sendMessage } from "@/app/actions/chat-messages"
import {
  addTranscriptEntry,
  EMPTY_TRANSCRIPT,
  finalTranscriptText,
  transcriptFromEntries,
  transcriptKey,
  type TranscriptEntry,
} from "@/lib/realtimekit/talk-transcript"

const NOTES_SAVE_DELAY_MS = 500
const AUTO_SCROLL_THRESHOLD_PX = 48

export function talkNotesDraftKey(userId: string, channelId: string): string {
  return `compass:talk:notes:v1:${userId}:${channelId}`
}

function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? ""
  } catch {
    return ""
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value.trim().length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* Storage unavailable: the draft still lasts for this call. */
  }
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

const TranscriptRow = React.memo(function TranscriptRow({
  entry,
}: {
  readonly entry: TranscriptEntry
}): React.ReactElement {
  return (
    <div
      className={`rounded-sm border p-2 text-sm ${
        entry.isPartialTranscript
          ? "border-white/10 bg-white/5 text-white/55"
          : "border-call-accent/50 bg-call-accent/10 text-white"
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
  )
})

/**
 * Notes and transcript state live here rather than in the meeting window, so
 * typing and live captions re-render only this panel. The panel stays mounted
 * while hidden to keep the draft, tab, and captured transcript.
 */
export function TalkNotesPanel({
  meeting,
  channelId,
  userId,
  open,
  onClose,
  transcriptEnabled,
  onTranscriptEnabledChange,
  onUnsavedNotesChange,
}: {
  readonly meeting: RTKMeeting
  readonly channelId: string
  readonly userId: string
  readonly open: boolean
  readonly onClose: () => void
  readonly transcriptEnabled: boolean
  readonly onTranscriptEnabledChange: (enabled: boolean) => void
  readonly onUnsavedNotesChange: (unsaved: boolean) => void
}): React.ReactElement {
  const draftKey = talkNotesDraftKey(userId, channelId)
  const [notes, setNotes] = React.useState(() => readDraft(draftKey))
  const [savedNotes, setSavedNotes] = React.useState("")
  const [notesStatus, setNotesStatus] = React.useState<string | null>(() =>
    readDraft(draftKey).trim().length > 0
      ? "Restored unsaved notes from your last visit to this meeting."
      : null
  )
  const [activePanel, setActivePanel] = React.useState<"notes" | "transcript">(
    "notes"
  )
  const [transcript, setTranscript] = React.useState(EMPTY_TRANSCRIPT)
  const transcriptListRef = React.useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = React.useRef(true)
  const notesRef = React.useRef(notes)
  notesRef.current = notes

  const unsaved = notes.trim().length > 0 && notes.trim() !== savedNotes
  React.useEffect(() => {
    onUnsavedNotesChange(unsaved)
  }, [onUnsavedNotesChange, unsaved])

  // Persist the draft after typing pauses, and immediately if the window closes.
  React.useEffect(() => {
    const timer = window.setTimeout(
      () => writeDraft(draftKey, unsaved ? notes : ""),
      NOTES_SAVE_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [draftKey, notes, unsaved])
  React.useEffect(() => {
    const flush = (): void => {
      const current = notesRef.current
      if (current.trim() !== savedNotes) writeDraft(draftKey, current)
    }
    window.addEventListener("pagehide", flush)
    return () => window.removeEventListener("pagehide", flush)
  }, [draftKey, savedNotes])

  React.useEffect(() => {
    if (!transcriptEnabled) return
    const handleTranscript = (entry: TranscriptEntry): void => {
      setTranscript((current) => addTranscriptEntry(current, entry))
    }
    meeting.ai.on("transcript", handleTranscript)
    setTranscript(transcriptFromEntries(meeting.ai.transcripts))
    return () => {
      meeting.ai.off("transcript", handleTranscript)
    }
  }, [meeting, transcriptEnabled])

  // Follow new lines unless the reader has scrolled up.
  React.useLayoutEffect(() => {
    const list = transcriptListRef.current
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight
  }, [transcript.entries, activePanel, open])

  const hasFinalTranscript = transcript.entries.some(
    (entry) => !entry.isPartialTranscript
  )

  const saveMeetingNotes = async (): Promise<void> => {
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
    if (result.success) {
      setSavedNotes(trimmed)
      writeDraft(draftKey, "")
    }
    setNotesStatus(
      result.success
        ? "Saved to this conversation."
        : result.error ?? "Failed to save notes."
    )
  }

  const saveTranscript = async (): Promise<void> => {
    const text = finalTranscriptText(transcript.entries)
    if (text.length === 0) {
      setNotesStatus("No finalized transcript lines to save yet.")
      return
    }

    setNotesStatus("Saving transcript...")
    const result = await sendMessage({
      channelId,
      content: `### Meeting transcript\n\n${text}`,
      contentHtml: `<section><h3>Meeting transcript</h3><pre>${escapeHtml(text)}</pre></section>`,
    })
    setNotesStatus(
      result.success
        ? "Transcript saved to this conversation."
        : result.error ?? "Failed to save transcript."
    )
  }

  const toggleTranscriptCapture = (): void => {
    const nextEnabled = !transcriptEnabled
    onTranscriptEnabledChange(nextEnabled)
    setNotesStatus(
      nextEnabled
        ? "Captions and transcript capture started for you."
        : "Captions and transcript capture turned off for you."
    )
  }

  return (
    <aside id="talk-notes-transcript" aria-label="Notes and transcript" hidden={!open}
      className="min-h-0 border-t border-border bg-background xl:border-l xl:border-t-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 border-b border-white/10 p-2">
          <button
            type="button"
            onClick={() => setActivePanel("notes")}
            className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
              activePanel === "notes"
                ? "bg-call-accent text-white"
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
                ? "bg-call-accent text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            Transcript
          </button>
          <Button type="button" variant="ghost" size="icon"
            aria-label="Close Notes & Transcript" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        {activePanel === "notes" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.currentTarget.value)}
              placeholder="Meeting notes..."
              aria-label="Meeting notes"
              className="min-h-0 flex-1 resize-none rounded-sm border border-white/15 bg-white/5 p-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-call-focus"
            />
            <button
              type="button"
              onClick={() => void saveMeetingNotes()}
              className="rounded-sm bg-call-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-call-accent-hover"
            >
              Save Notes to Conversation
            </button>
            {notesStatus ? (
              <p className="text-xs text-white/55">{notesStatus}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={transcriptListRef}
              onScroll={(event) => {
                const list = event.currentTarget
                stickToBottomRef.current =
                  list.scrollHeight - list.scrollTop - list.clientHeight <
                  AUTO_SCROLL_THRESHOLD_PX
              }}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
            >
              {!transcriptEnabled ? (
                <div className="rounded-sm border border-white/10 bg-white/5 p-3 text-sm text-white/65">
                  <p className="font-semibold text-white">
                    Captions and transcript capture are off.
                  </p>
                  <p className="mt-1">
                    Start it only after everyone knows the meeting is being
                    transcribed.
                  </p>
                </div>
              ) : null}
              {transcript.entries.length === 0 ? (
                <p className="rounded-sm border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                  {transcriptEnabled
                    ? "No transcript lines yet."
                    : "No transcript has been captured for this meeting."}
                </p>
              ) : (
                transcript.entries.map((entry) => (
                  <TranscriptRow key={transcriptKey(entry)} entry={entry} />
                ))
              )}
            </div>
            <div className="grid shrink-0 gap-2 border-t border-white/10 p-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={toggleTranscriptCapture}
                className={`rounded-sm px-3 py-2 text-sm font-semibold text-white transition-colors ${
                  transcriptEnabled
                    ? "border border-white/20 bg-white/10 hover:bg-white/15"
                    : "bg-call-accent hover:bg-call-accent-hover"
                }`}
              >
                {transcriptEnabled
                  ? "Turn Captions Off"
                  : "Turn Captions On"}
              </button>
              <button
                type="button"
                onClick={() => void saveTranscript()}
                disabled={!hasFinalTranscript}
                className="rounded-sm bg-call-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-call-accent-hover disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
              >
                Save Transcript to Conversation
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
