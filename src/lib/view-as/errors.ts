/*
 * The View as error and guard mode, on their own so the many shared modules
 * that refuse writes (action context, preview checks, Google clients) import
 * a few lines instead of the whole binding guard. Keeps server chunks small
 * (scripts/bundle-duplicates-check.mjs).
 */
import { VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/view-as/constants"

/** "reject": throw (server actions). "skip": drop quietly (page renders). */
export type GuardMode = "reject" | "skip"

export class ViewAsReadOnlyError extends Error {
  constructor(detail?: string) {
    super(detail ? `${VIEW_AS_READ_ONLY_MESSAGE} (${detail})` : VIEW_AS_READ_ONLY_MESSAGE)
    this.name = "ViewAsReadOnlyError"
  }
}
