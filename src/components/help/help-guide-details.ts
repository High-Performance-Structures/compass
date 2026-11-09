"use client"

import * as React from "react"

import { previewScoped } from "@/components/background-requests"
import type {
  HelpGuideListing,
  HelpGuidePreview,
} from "@/components/help/help-ui-model"

/**
 * Loads full Help article text and search data for the Help drawer.
 *
 * Layouts send only light guide listings with each page; the article text
 * (~800 KB for a fully permitted person) comes from `GET /api/help/guides`
 * the first time the drawer opens. The response is kept for the rest of the
 * browser session (until a full page reload), one copy per viewer scope so
 * an owner/vendor preview never reuses the staff list or the other way round.
 */

type HelpGuideDetailsState =
  | Readonly<{ status: "idle" | "loading" }>
  | Readonly<{ status: "ready"; guides: readonly HelpGuidePreview[] }>
  | Readonly<{ status: "error" }>

const detailsByUrl = new Map<string, Promise<readonly HelpGuidePreview[]>>()

function loadHelpGuideDetails(): Promise<readonly HelpGuidePreview[]> {
  const url = previewScoped("/api/help/guides")
  const cached = detailsByUrl.get(url)
  if (cached) return cached

  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Help request failed (${response.status})`)
      const body: { readonly guides: readonly HelpGuidePreview[] } = await response.json()
      return body.guides
    })
    .catch((error: unknown) => {
      // Forget failures so the next open tries again.
      detailsByUrl.delete(url)
      throw error
    })
  detailsByUrl.set(url, request)
  return request
}

/**
 * Full guides for the listings the layout allowed, loaded once `enabled` is
 * true. Results are narrowed to `listings` so a guide removed from the page's
 * list since the session copy was fetched is never shown.
 */
export function useHelpGuideDetails(
  enabled: boolean,
  listings: readonly HelpGuideListing[],
): Readonly<{ state: HelpGuideDetailsState; retry: () => void }> {
  const [state, setState] = React.useState<HelpGuideDetailsState>({ status: "idle" })
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!enabled) return
    let active = true
    setState((current) => (current.status === "ready" ? current : { status: "loading" }))
    loadHelpGuideDetails().then(
      (guides) => {
        if (active) setState({ status: "ready", guides })
      },
      () => {
        if (active) setState({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [enabled, attempt])

  const narrowed = React.useMemo<HelpGuideDetailsState>(() => {
    if (state.status !== "ready") return state
    const allowedIds = new Set(listings.map((guide) => guide.id))
    return {
      status: "ready",
      guides: state.guides.filter((guide) => allowedIds.has(guide.id)),
    }
  }, [listings, state])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return { state: narrowed, retry }
}
