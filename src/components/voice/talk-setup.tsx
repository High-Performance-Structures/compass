"use client"

import type * as React from "react"
import { Button } from "@/components/ui/button"

export function TalkSetup({
  title,
  preview,
  settings,
  videoEnabled,
  audioEnabled,
  busy,
  canJoin,
  joining,
  error,
  onVideo,
  onAudio,
  onJoin,
  onCancel
}: {
  readonly title: string
  readonly preview: React.ReactNode
  readonly settings: React.ReactNode
  readonly videoEnabled: boolean
  readonly audioEnabled: boolean
  readonly busy: boolean
  readonly canJoin: boolean
  readonly joining: boolean
  readonly error: string | null
  readonly onVideo: () => void
  readonly onAudio: () => void
  readonly onJoin: () => void
  readonly onCancel: () => void
}): React.ReactElement {
  return (
    <main className="fixed inset-0 z-[100] overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8">
        <header>
          <h1 className="text-xl font-semibold">Ready to join {title}?</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your camera, background, and audio. Your preview stays private
            until you join.
          </p>
        </header>
        <div className="grid gap-8 lg:grid-cols-2">
          <section className="space-y-4">
            {preview}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onVideo}
              >
                {videoEnabled ? "Turn preview off" : "Preview camera"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onAudio}
              >
                {audioEnabled ? "Stop microphone test" : "Test microphone"}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex gap-3 border-t pt-4">
              <Button
                type="button"
                disabled={!canJoin || busy}
                onClick={onJoin}
              >
                {joining ? "Joining…" : "Join meeting"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={joining}
                onClick={onCancel}
              >
                Cancel
              </Button>
            </div>
          </section>
          <section aria-label="Meeting preferences">{settings}</section>
        </div>
      </div>
    </main>
  )
}
