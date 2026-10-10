/** What the job needs to know about a record before printing it. */
export type LoadedPaperTrailRecord = {
  readonly projectId: string
  /**
   * Changes whenever anything on the printed copy changes. The job compares
   * it with the last saved version and skips printing when they match.
   */
  readonly version: string
  /** File name without extension; the job adds ".pdf". */
  readonly fileBaseName: string
}
