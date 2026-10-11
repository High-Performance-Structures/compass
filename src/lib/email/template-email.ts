/** A template filled in for one job, ready to review. */
export type TemplateEmailDraft = {
  readonly templateId: string
  readonly label: string
  /** Who it goes to and from which mailbox, shown under the title. */
  readonly description: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly body: string
  /** Merge fields that were empty, to fill in before sending. */
  readonly missing: readonly string[]
}
