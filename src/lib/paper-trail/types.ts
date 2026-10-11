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
  /**
   * Folders below the category folder, outermost first. Missing ones are
   * created with `name`; an existing folder matching an alternative is used.
   * Only per-occurrence folders (such as a draw's folder) belong here; the
   * category folders themselves always come from the department template.
   */
  readonly subfolders: readonly PaperTrailSubfolder[]
  /**
   * Names a hand-saved copy of this record would carry (its number), used to
   * avoid writing a second copy beside it. Empty skips the check.
   */
  readonly duplicateKeys: readonly string[]
}

export type PaperTrailSubfolder = { readonly name: string; readonly alternatives: readonly string[] }
