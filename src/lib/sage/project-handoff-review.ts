export function isGooglePhaseHandoffAwaitingClientReview(input: {
  readonly sourceSystem: string | null
  readonly sourceRecordType: string | null
  readonly status: string
  readonly syncDirection: string | null
  readonly sageWriteStatus: string | null
  readonly syncStatus: string
}): boolean {
  return (
    input.sourceSystem === "google_project_manager" &&
    input.sourceRecordType === "sage_project_handoff" &&
    input.status === "needs_review" &&
    input.syncDirection === "write" &&
    input.sageWriteStatus === "not_ready" &&
    input.syncStatus === "needs_review"
  )
}
