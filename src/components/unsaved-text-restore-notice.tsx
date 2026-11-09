"use client"

/**
 * Puts back text someone typed before a Compass update reloaded the page.
 *
 * DeploymentRefreshPrompt copies typed text into this tab's storage when a
 * save fails because of an update, or when the page is refreshed while the
 * update notice shows (src/lib/deployment/unsaved-text.ts explains what is
 * kept and the limits). After the reload this component fills the same fields
 * again as they appear, for up to RESTORE_WATCH_MS, then forgets the copy. If
 * anything was filled it shows "Restored your unsaved text" with Discard,
 * which puts back what the fields held before.
 */

import * as React from "react"
import { IconRestore } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  clearSnapshot,
  discardRestoredText,
  loadSnapshot,
  RESTORE_WATCH_MS,
  restoreTypedText,
  type RestoredField,
} from "@/lib/deployment/unsaved-text"

// Let the page hydrate before filling fields, so React keeps the values.
const FIRST_RESTORE_DELAY_MS = 400

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function UnsavedTextRestoreNotice(): React.ReactElement | null {
  const [restored, setRestored] = React.useState<readonly RestoredField[]>([])

  React.useEffect(() => {
    const storage = tabStorage()
    const snapshot = loadSnapshot(storage, window.location.pathname, Date.now())
    if (snapshot === null) return
    // One reload gets one chance: forget the copy now so it never returns twice.
    clearSnapshot(storage)

    const pending = new Map(snapshot.fields.map((field) => [field.key, field.value]))
    let observer: MutationObserver | null = null

    function attempt(): void {
      const filled = restoreTypedText(document, pending)
      if (filled.length > 0) setRestored((current) => [...current, ...filled])
      if (pending.size === 0) stop()
    }

    function stop(): void {
      observer?.disconnect()
      observer = null
      window.clearTimeout(firstTimer)
      window.clearTimeout(stopTimer)
    }

    const firstTimer = window.setTimeout(() => {
      attempt()
      if (pending.size === 0) return
      observer = new MutationObserver(() => attempt())
      observer.observe(document.body, { childList: true, subtree: true })
    }, FIRST_RESTORE_DELAY_MS)
    const stopTimer = window.setTimeout(stop, RESTORE_WATCH_MS)

    return stop
  }, [])

  if (restored.length === 0) return null

  return (
    <aside
      role="status"
      data-testid="unsaved-text-restored"
      className="fixed bottom-3 left-3 z-[100] flex max-w-sm flex-wrap items-center gap-3 border border-primary/30 bg-background px-4 py-3 shadow-xl"
    >
      <p className="flex items-center gap-2 text-sm">
        <IconRestore className="size-4" aria-hidden />
        Restored your unsaved text
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            discardRestoredText(restored)
            setRestored([])
          }}
        >
          Discard
        </Button>
        <Button type="button" size="sm" onClick={() => setRestored([])}>
          Keep
        </Button>
      </div>
    </aside>
  )
}
