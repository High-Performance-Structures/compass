import type { RecordSheet } from "@/lib/paper-trail/document"

/** A Compass record ready to be written to Drive. */
export type LoadedPaperTrailRecord = {
  readonly projectId: string
  /**
   * Changes whenever anything shown on the sheet changes. The job compares it
   * with the last saved version and skips rendering when they match.
   */
  readonly version: string
  /** File name without extension; the job adds ".pdf". */
  readonly fileBaseName: string
  readonly sheet: Omit<RecordSheet, "generatedAt" | "milestoneLabel">
}
