"use client"
import * as React from "react"
import { saveProjectComposition, setProjectDraftDiscarded } from "@/app/actions/correspondence-saved-drafts"
import type { CompositionContent, SavedComposition } from "@/lib/correspondence/types"
import { compositionHasContent } from "@/lib/correspondence/draft-content"

export type CompositionDraftHandle = { readonly flush: () => Promise<boolean> }
export function useCompositionDraft(input: {
  readonly projectId: string
  readonly initial: SavedComposition | null
  readonly content: CompositionContent
  readonly busy: boolean
  readonly onStatus: (message: string | null) => void
  readonly onSaved: () => void
}): {
  readonly save: (content?: CompositionContent) => Promise<SavedComposition | null>
  readonly flush: () => Promise<boolean>
  readonly discard: () => Promise<boolean>
  readonly stop: () => void
  readonly restore: () => Promise<boolean>
  readonly acceptSaved: (content: CompositionContent, version: number) => void
} {
  const [id] = React.useState(() => input.initial?.id ?? crypto.randomUUID())
  const version = React.useRef(input.initial?.version ?? 0)
  const savedKey = React.useRef(input.initial ? JSON.stringify(input.initial.content) : "")
  const stopped = React.useRef(false)
  const queue = React.useRef<Promise<SavedComposition | null>>(Promise.resolve(input.initial))
  const latest = React.useRef(input)
  React.useEffect(() => { latest.current = input })
  const key = JSON.stringify(input.content)
  const save = React.useCallback((override?: CompositionContent): Promise<SavedComposition | null> => {
    const content = override ?? latest.current.content
    const pending = queue.current.catch(() => null).then(async () => {
      if (stopped.current) return null
      try {
        const result = await saveProjectComposition(latest.current.projectId, id, version.current, content)
        if (!result.success) { latest.current.onStatus(result.error); return null }
        version.current = result.data.version
        savedKey.current = JSON.stringify(content)
        latest.current.onStatus("Draft saved. Only you can see it.")
        latest.current.onSaved()
        return result.data
      } catch { latest.current.onStatus("Draft could not be saved. Keep this page open and try again."); return null }
    })
    queue.current = pending
    return pending
  }, [id])
  const flush = React.useCallback(async (): Promise<boolean> => {
    await queue.current
    if (stopped.current || savedKey.current === JSON.stringify(latest.current.content) || !compositionHasContent(latest.current.content) && version.current === 0) return true
    return await save() !== null
  }, [save])
  React.useEffect(() => {
    if (input.busy || stopped.current || key === savedKey.current || !compositionHasContent(input.content) && version.current === 0) return
    const timer = window.setTimeout(() => { void save() }, 700)
    return () => window.clearTimeout(timer)
  }, [key, input.busy, input.content, save])
  React.useEffect(() => {
    const protect = (event: BeforeUnloadEvent): void => {
      if (!stopped.current && savedKey.current !== JSON.stringify(latest.current.content) && compositionHasContent(latest.current.content)) { event.preventDefault(); event.returnValue = "" }
    }
    window.addEventListener("beforeunload", protect)
    return () => window.removeEventListener("beforeunload", protect)
  }, [])
  async function discard(): Promise<boolean> {
    if (!await flush()) return false
    stopped.current = true
    if (version.current === 0) return true
    const result = await setProjectDraftDiscarded(input.projectId, id, version.current, true)
    if (!result.success) { stopped.current = false; input.onStatus(result.error); return false }
    version.current = result.data.version
    input.onSaved()
    return true
  }
  async function restore(): Promise<boolean> {
    const result = await setProjectDraftDiscarded(input.projectId, id, version.current, false)
    if (!result.success) { input.onStatus(result.error); return false }
    version.current = result.data.version
    stopped.current = false
    input.onSaved()
    return true
  }
  return { save, flush, discard, restore, acceptSaved: (content, nextVersion) => { version.current = nextVersion; savedKey.current = JSON.stringify(content) }, stop: () => { stopped.current = true } }
}
