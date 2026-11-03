"use client"

import {
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type TransitionStartFunction,
} from "react"

import { EMPTY_LINE, type LineDraft } from "./estimate-workspace-helpers"

/** What every estimate workspace area needs to run a server action. */
export type EstimateWorkspaceRunner = {
  readonly projectId: string
  readonly isPending: boolean
  readonly startTransition: TransitionStartFunction
  readonly setMessage: (message: string | null) => void
  /** Shows the message and refreshes the page data. */
  readonly finish: (message: string) => void
}

export type EstimateLineEditorState = {
  readonly line: LineDraft
  readonly setLine: Dispatch<SetStateAction<LineDraft>>
  readonly insertAfterLineId: string | null
  /** Group whose "Add item" opened the editor, so it opens at that group's end. */
  readonly addToGroupKey: string | null
  readonly lineEditorRef: RefObject<HTMLFormElement | null>
  readonly openLineEditor: (
    nextLine: LineDraft,
    insertionPoint?: string | null,
    groupKey?: string | null
  ) => void
  readonly closeLineEditor: () => void
}

export function useEstimateLineEditor(): EstimateLineEditorState {
  const [line, setLine] = useState<LineDraft>(EMPTY_LINE)
  const [insertAfterLineId, setInsertAfterLineId] = useState<string | null>(
    null
  )
  const lineEditorRef = useRef<HTMLFormElement>(null)
  const [addToGroupKey, setAddToGroupKey] = useState<string | null>(null)

  function openLineEditor(
    nextLine: LineDraft,
    insertionPoint: string | null = null,
    groupKey: string | null = null
  ): void {
    setLine(nextLine)
    setInsertAfterLineId(insertionPoint)
    setAddToGroupKey(groupKey)
    window.requestAnimationFrame(() => {
      const description = lineEditorRef.current
        ?.querySelector<HTMLInputElement>("#estimateDescription")
      // The editor opens right under the line, so only nudge it into view
      // when part of it is off screen; the person keeps their place.
      lineEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      description?.focus({ preventScroll: true })
    })
  }

  function closeLineEditor(): void {
    setLine(EMPTY_LINE)
    setInsertAfterLineId(null)
    setAddToGroupKey(null)
  }

  return {
    line,
    setLine,
    insertAfterLineId,
    addToGroupKey,
    lineEditorRef,
    openLineEditor,
    closeLineEditor,
  }
}
