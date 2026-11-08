import type { SageClientJobPayload } from "@/lib/domain/project/rules"
import { sameSageRecordId } from "@/lib/sage/record-id"
import { isRecord } from "@/lib/shared/guards"

/**
 * What the project Overview says about a job's Sage link, and when staff may
 * send it to Sage. Pure: the action reads the rows and the card renders the
 * result.
 *
 * A job Compass already tried to create (it has a client/job write
 * operation) can be sent again when that write failed. A job with no write
 * and no Sage job (one imported from Buildertrend, say) can be created in
 * Sage once, after staff confirm the job name and client. A linked job is
 * never sent: the Windows writer matches an existing Sage job by its exact
 * name, so a resend could add a duplicate job in Sage.
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
  | {
      readonly kind: "not_linked"
      /** What "Create in Sage" would send, or null when it can't be offered. */
      readonly create: SageJobCreatePreview | null
      /** Why "Create in Sage" isn't offered (for example, no client picked). */
      readonly createBlocker: string | null
    }

/** The Sage client a new Sage job would use. */
export type SageJobCreateClient =
  /** The Compass client is already linked to this Sage client. */
  | { readonly kind: "linked"; readonly sageClientNumber: string }
  /**
   * Sage has clients with a matching name; staff pick one. A new client is
   * allowed only when none has exactly the same name (the writer refuses that).
   */
  | { readonly kind: "choose"; readonly choices: readonly SageClientChoice[]; readonly allowNew: boolean }
  /** No matching Sage client: the writer adds one from the Compass client. */
  | { readonly kind: "new" }

/** The confirmation shown before "Create in Sage" queues the job write. */
export type SageJobCreatePreview = {
  readonly jobName: string
  readonly clientName: string
  readonly jobTypeName: string
  readonly jobStatusName: string
  readonly client: SageJobCreateClient
}

/** What staff picked in the confirmation, when the client needed choosing. */
export type SageJobCreateSelection =
  | { readonly kind: "sage_client"; readonly sageRecordId: string; readonly sageClientNumber: string }
  | { readonly kind: "new_client" }

/** Why an accepted estimate's Sage export stopped when the project has no Sage job. */
export const SAGE_JOB_MISSING_ESTIMATE_REASON =
  "The job isn't in Sage yet. Use Create in Sage (or Send to Sage) on the project Overview; the estimate follows automatically."

/** Every wording of that reason stored on exports, current first, so they re-queue when the job is sent. */
export const SAGE_JOB_MISSING_ESTIMATE_REASONS: readonly string[] = [
  SAGE_JOB_MISSING_ESTIMATE_REASON,
  "The job isn't in Sage yet. Send it from the project Overview (Send to Sage) or link it to its Sage job; the estimate follows.",
]

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
  /** "Create in Sage" for a job with no write; omitted means not offered. */
  readonly create?: { readonly preview: SageJobCreatePreview | null; readonly blocker: string | null }
}): ProjectSageStatus {
  if (input.sageJobNumber?.trim()) {
    return { kind: "linked", jobNumber: input.sageJobNumber.trim(), statusName: input.sageJobStatusName }
  }
  if (!input.write) {
    return { kind: "not_linked", create: input.create?.preview ?? null, createBlocker: input.create?.blocker ?? null }
  }
  if (input.write.status === "queued" || input.write.status === "running") return { kind: "sending" }
  if (input.write.status === "failed") {
    return {
      kind: "failed",
      reason: projectSageFailureReason(input.write.errorMessage, input.clientName),
      clientChoices: isSageClientNameMatchError(input.write.errorMessage) ? input.clientChoices : [],
    }
  }
  // Succeeded without a job on the project row should not happen; offer nothing to resend.
  return { kind: "not_linked", create: null, createBlocker: null }
}

/** Case- and space-insensitive name key for matching a Compass client to Sage directory rows. */
export function sageClientNameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
}

const CORPORATE_WORDS = new Set([
  "and", "the", "llc", "inc", "incorporated", "co", "corp", "corporation", "company", "ltd", "lp", "llp", "pllc",
])

/** Name words for loose matching: punctuation, "&"/"and" and corporate suffixes dropped. */
export function sageClientNameWords(name: string): readonly string[] {
  return sageClientNameKey(name)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !CORPORATE_WORDS.has(word))
}

/**
 * Sage clients whose name matches the Compass client's: the same name, or one
 * name's words starting the other's ("Flatiron Development" and "Flatiron
 * Development & Custom Homes, LLC"). Exact matches come first.
 */
export function similarSageClientChoices(
  clientName: string,
  rows: readonly SageClientChoice[],
): { readonly choices: readonly SageClientChoice[]; readonly exactMatch: boolean } {
  const key = sageClientNameKey(clientName)
  const words = sageClientNameWords(clientName)
  if (!key) return { choices: [], exactMatch: false }
  const exact: SageClientChoice[] = []
  const similar: SageClientChoice[] = []
  for (const row of rows) {
    if (sageClientNameKey(row.name) === key) {
      exact.push(row)
      continue
    }
    const rowWords = sageClientNameWords(row.name)
    const [shorter, longer] = rowWords.length <= words.length ? [rowWords, words] : [words, rowWords]
    if (shorter.length > 0 && shorter.every((word, index) => longer[index] === word)) similar.push(row)
  }
  return { choices: [...exact, ...similar], exactMatch: exact.length > 0 }
}

/** The Sage client a new job would use, from the Compass client's link and the matching Sage clients. */
export function sageJobCreateClient(
  customer: { readonly sageClientId: string | null; readonly sageClientNumber: string | null },
  similar: { readonly choices: readonly SageClientChoice[]; readonly exactMatch: boolean },
): SageJobCreateClient {
  if (customer.sageClientId && customer.sageClientNumber) {
    return { kind: "linked", sageClientNumber: customer.sageClientNumber }
  }
  if (similar.choices.length > 0) return { kind: "choose", choices: similar.choices, allowNew: !similar.exactMatch }
  return { kind: "new" }
}

/** Why "Create in Sage" can't be offered for this job's client, or null. */
export function sageJobCreateBlocker(
  customer: { readonly sageClientId: string | null; readonly sageClientNumber: string | null } | null,
): string | null {
  if (!customer) return "Choose this job's client on the Information page before creating it in Sage."
  if (Boolean(customer.sageClientId) !== Boolean(customer.sageClientNumber)) {
    return "This job's client has an incomplete Sage link. Fix its Sage ID and number in Contacts first."
  }
  return null
}

/**
 * The Sage client link the job write carries for staff's selection: the linked
 * client, the chosen matching client, or none (the writer adds a new client).
 */
export function resolveSageJobCreateClient(
  client: SageJobCreateClient,
  linked: { readonly sageClientId: string | null; readonly sageClientNumber: string | null },
  selection: SageJobCreateSelection | null,
):
  | { readonly ok: true; readonly link: { readonly sageClientId: string; readonly sageClientNumber: string } | null }
  | { readonly ok: false; readonly error: string } {
  if (client.kind === "linked") {
    if (!linked.sageClientId || !linked.sageClientNumber) return { ok: false, error: "This job's client changed. Refresh and try again." }
    return { ok: true, link: { sageClientId: linked.sageClientId, sageClientNumber: linked.sageClientNumber } }
  }
  if (client.kind === "new") {
    if (selection?.kind === "sage_client") return { ok: false, error: "That Sage client isn't a match for this job's client. Refresh and try again." }
    return { ok: true, link: null }
  }
  if (!selection) return { ok: false, error: "Choose the Sage client for this job." }
  if (selection.kind === "new_client") {
    return client.allowNew
      ? { ok: true, link: null }
      : { ok: false, error: "Sage already has a client with this exact name. Choose it instead of adding another." }
  }
  const chosen = client.choices.find((choice) =>
    sameSageRecordId(choice.sageRecordId, selection.sageRecordId) &&
    choice.sageClientNumber === selection.sageClientNumber)
  if (!chosen) return { ok: false, error: "That Sage client isn't a match for this job's client. Refresh and try again." }
  return { ok: true, link: { sageClientId: chosen.sageRecordId.toUpperCase(), sageClientNumber: chosen.sageClientNumber } }
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

/**
 * The saved write payload with its `client` replaced, for a write moved to the
 * client its old client was merged into. The job part stays as queued.
 */
export function payloadWithClient(payloadJson: string, client: SageClientJobPayload["client"]): string | null {
  let payload: unknown
  try { payload = JSON.parse(payloadJson) } catch { return null }
  if (!isRecord(payload) || payload.operationType !== "ensure_client_and_job" || !isRecord(payload.job)) return null
  return JSON.stringify({ ...payload, client })
}
