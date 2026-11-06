import { isRecord } from "@/lib/shared/guards"

/**
 * What the project Overview says about a job's Sage link, and when staff may
 * send it to Sage again. Pure: the action reads the rows and the card renders
 * the result.
 *
 * Only a job Compass already tried to create (it has a client/job write
 * operation) can be sent from here. The Windows writer matches an existing
 * Sage job by its exact name, so resending a linked job, or sending a job
 * that predates Compass, could add a duplicate job in Sage.
 */

export type ProjectSageWriteRow = {
  readonly status: string
  readonly errorMessage: string | null
}

export type SageClientChoice = {
  readonly sageRecordId: string
  readonly sageClientNumber: string
  readonly name: string
  readonly email: string | null
}

export type ProjectSageStatus =
  | { readonly kind: "linked"; readonly jobNumber: string; readonly statusName: string | null }
  | { readonly kind: "sending" }
  | {
      readonly kind: "failed"
      readonly reason: string
      /** Sage clients to choose from when the writer stopped on a name match. */
      readonly clientChoices: readonly SageClientChoice[]
    }
  | { readonly kind: "not_linked" }

const NAME_MATCH_NO_EMAIL = "A Sage client matches the requested name but has no email"
const NAME_MATCH_OTHER_EMAIL = "A Sage client matches the requested name but not the requested email"

/** The writer stopped because a same-name Sage client exists that Compass isn't linked to. */
export function isSageClientNameMatchError(error: string | null): boolean {
  return Boolean(error && (error.startsWith(NAME_MATCH_NO_EMAIL) || error.startsWith(NAME_MATCH_OTHER_EMAIL)))
}

/** Plain-English reason for a failed send; the writer's text is kept for anything unrecognized. */
export function projectSageFailureReason(error: string | null, clientName: string | null): string {
  const client = clientName?.trim() || "this client"
  if (error?.startsWith(NAME_MATCH_NO_EMAIL)) {
    return `Sage already has a client named ${client} with no email. Choose that client to use it for this job.`
  }
  if (error?.startsWith(NAME_MATCH_OTHER_EMAIL)) {
    return `Sage already has a client named ${client} with a different email. Choose that client if it is the same person.`
  }
  return error?.trim() ? `Sage didn't accept this job: ${error.trim()}` : "Sage didn't accept this job."
}

export function projectSageStatus(input: {
  readonly sageJobNumber: string | null
  readonly sageJobStatusName: string | null
  readonly write: ProjectSageWriteRow | null
  readonly clientName: string | null
  readonly clientChoices: readonly SageClientChoice[]
}): ProjectSageStatus {
  if (input.sageJobNumber?.trim()) {
    return { kind: "linked", jobNumber: input.sageJobNumber.trim(), statusName: input.sageJobStatusName }
  }
  if (!input.write) return { kind: "not_linked" }
  if (input.write.status === "queued" || input.write.status === "running") return { kind: "sending" }
  if (input.write.status === "failed") {
    return {
      kind: "failed",
      reason: projectSageFailureReason(input.write.errorMessage, input.clientName),
      clientChoices: isSageClientNameMatchError(input.write.errorMessage) ? input.clientChoices : [],
    }
  }
  // Succeeded without a job on the project row should not happen; offer nothing to resend.
  return { kind: "not_linked" }
}

/** Case- and space-insensitive name key for matching a Compass client to Sage directory rows. */
export function sageClientNameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
}

/**
 * The stored writer payload with the chosen Sage client link filled in. Returns
 * null when the payload isn't a client/job write.
 */
export function payloadWithSageClient(
  payloadJson: string,
  link: { readonly sageClientId: string; readonly sageClientNumber: string } | null,
): string | null {
  let payload: unknown
  try { payload = JSON.parse(payloadJson) } catch { return null }
  if (!isRecord(payload) || payload.operationType !== "ensure_client_and_job") return null
  const client = payload.client
  if (!isRecord(client) || !isRecord(payload.job)) return null
  if (!link) return payloadJson
  return JSON.stringify({
    ...payload,
    client: { ...client, sageClientId: link.sageClientId, sageClientNumber: link.sageClientNumber },
  })
}
