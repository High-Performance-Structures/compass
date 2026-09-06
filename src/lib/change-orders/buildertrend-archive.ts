export type BuildertrendArchiveSourceRow = {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string | null
  readonly requestedProjectId: string | null
  readonly sourceKey: string
  readonly sourceRecordType: string
  readonly buildertrendJobId: string | null
  readonly buildertrendRecordId: string | null
  readonly buildertrendRecordNumber: string | null
  readonly buildertrendUrl: string | null
  readonly title: string
  readonly sourceStatus: string | null
  readonly clientName: string | null
  readonly rawPayloadJson: string | null
  readonly verifiedArchiveDriveFileId: string | null
  readonly verifiedArchiveDriveUrl: string | null
  readonly reviewStatus: string
  readonly promotionStatus: string
  readonly updatedAt: string
}

export type BuildertrendArchiveObservationRow = {
  readonly id: string
  readonly organizationId: string
  readonly entityKind: string
  readonly entityKey: string
  readonly entityId: string
  readonly observedPayloadJson: string
  readonly observedAt: string
}

export type ArchivedBuildertrendChangeOrderLine = {
  readonly id: string
  readonly lineNumber: number
  readonly description: string
  readonly costCodeDisplay: string
  readonly unitCostDisplay: string
  readonly quantityDisplay: string
  readonly clientPriceDisplay: string
}

export type ArchivedBuildertrendChangeOrderActivity = {
  readonly id: string
  readonly displayOrder: number
  readonly kind: string
  readonly actor: string
  readonly displayedAt: string
  readonly details: readonly string[]
}

export type ArchivedBuildertrendEvidence =
  | {
      readonly status: "verified"
      readonly driveFileId: string
      readonly driveUrl: string
      readonly sha256: string
    }
  | { readonly status: "held"; readonly reason: string }

export type ArchivedBuildertrendManifestEvidence =
  | {
      readonly status: "verified"
      readonly driveFileId: string
      readonly driveUrl: string
      readonly sha256: string
    }
  | { readonly status: "held"; readonly reason: string }

export type ArchivedBuildertrendChangeOrder = {
  readonly kind: "buildertrend_archive"
  readonly id: string
  readonly projectId: string
  readonly sourceRecordId: string
  readonly changeOrderNumber: string
  readonly title: string
  readonly scope: string
  readonly sourceStatus: string
  readonly displayStatus: string
  readonly purpose: "Variance" | "Not classified"
  readonly requester: "Unknown — not established by source"
  readonly approvalActor: string | null
  readonly ownerRequested: false
  readonly budgetActive: false
  readonly lines: readonly ArchivedBuildertrendChangeOrderLine[]
  readonly activity: readonly ArchivedBuildertrendChangeOrderActivity[]
  readonly archiveEvidence: ArchivedBuildertrendEvidence
  readonly manifestEvidence: ArchivedBuildertrendManifestEvidence
  readonly observedAt: string
  readonly updatedAt: string
}

export type ArchivedBuildertrendChangeOrderParseResult =
  | { readonly kind: "record"; readonly record: ArchivedBuildertrendChangeOrder }
  | { readonly kind: "held"; readonly sourceRecordId: string; readonly reason: string }

const MAX_PAYLOAD_BYTES = 1_000_000
const MAX_LINES = 250
const MAX_ACTIVITY = 500
const MAX_ACTIVITY_DETAILS = 30
const SHA256 = /^[a-f0-9]{64}$/
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/
const ALLOWED_ACTIVITY_KINDS = new Set([
  "Approved",
  "Created",
  "Line item added",
  "Line item updated",
  "Recalled",
  "Sent / Pending",
  "Updated",
])

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function boundedString(
  value: unknown,
  maximum = 10_000
): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    return null
  }
  return value
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null
}

function parseJson(value: string): unknown {
  if (value.length === 0 || value.length > MAX_PAYLOAD_BYTES) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function exactBuildertrendUrl(
  value: string,
  sourceRecordId: string,
  buildertrendJobId: string
): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.host === "buildertrend.net" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname ===
        `/app/ChangeOrders/${sourceRecordId}/${buildertrendJobId}/Details`
    )
  } catch {
    return false
  }
}

function exactDriveUrl(value: string, driveFileId: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.host === "drive.google.com" &&
      !url.username &&
      !url.password &&
      url.pathname === `/file/d/${driveFileId}/view`
    )
  } catch {
    return false
  }
}

function displayStatus(
  sourceStatus: string,
  listStatus: string,
  detailStatus: string
): string | null {
  if (
    sourceStatus === "Approved (list and detail)" &&
    listStatus === "Approved" &&
    detailStatus === "Approved"
  ) {
    return "Approved · Buildertrend"
  }
  if (
    sourceStatus === "Draft (list and detail)" &&
    listStatus === "Draft" &&
    detailStatus === "Draft"
  ) {
    return "Draft · Buildertrend"
  }
  if (
    sourceStatus === "Recalled (list) / Draft (detail)" &&
    listStatus === "Recalled" &&
    detailStatus === "Draft"
  ) {
    return "Recalled / Draft · Buildertrend"
  }
  return null
}

function stringArray(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) return []
  const result: string[] = []
  for (const item of value) {
    const text = boundedString(item, 500)
    if (text) result.push(text)
  }
  return result
}

function describeChange(value: unknown): string | null {
  if (!object(value)) return null
  const kind = boundedString(value.kind, 120)
  const field = boundedString(value.field, 120)
  const from = boundedString(value.from, 500)
  const to = boundedString(value.to, 500)
  const costCode = boundedString(value.costCode, 500)
  const costCodeFrom = boundedString(value.costCodeFrom, 500)
  const costCodeTo = boundedString(value.costCodeTo, 500)
  const clientPrice = boundedString(value.clientPrice, 120)
  const amount = boundedString(value.amount, 120)
  const amountFrom = boundedString(value.amountFrom, 120)
  const amountTo = boundedString(value.amountTo, 120)
  const fields = stringArray(value.fields, 20)
  const labels = stringArray(value.additionalDisplayedLabels, 20)
  const parts = [
    kind,
    field && from && to ? `${field}: ${from} → ${to}` : null,
    fields.length > 0 && from && to ? `${fields.join(", ")}: ${from} → ${to}` : null,
    costCode,
    costCodeFrom && costCodeTo ? `${costCodeFrom} → ${costCodeTo}` : null,
    clientPrice ?? amount,
    amountFrom && amountTo ? `${amountFrom} → ${amountTo}` : null,
    labels.length > 0 ? labels.join(", ") : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(" · ") : null
}

function activityDetails(value: Readonly<Record<string, unknown>>): readonly string[] {
  const result: string[] = []
  const expandedChange = boundedString(value.expandedChange, 500)
  if (expandedChange) result.push(expandedChange)
  const direct = describeChange(value)
  if (direct) result.push(direct)
  if (Array.isArray(value.changes) && value.changes.length <= MAX_ACTIVITY_DETAILS) {
    for (const change of value.changes) {
      const description = describeChange(change)
      if (description) result.push(description)
    }
  }
  return result.slice(0, MAX_ACTIVITY_DETAILS)
}

function parseLines(
  sourceRecord: Readonly<Record<string, unknown>>,
  sourceLineIdentity: Readonly<Record<string, unknown>>,
  sourceRecordId: string
): readonly ArchivedBuildertrendChangeOrderLine[] | null {
  const values = sourceRecord.lines
  const identities = sourceLineIdentity.rows
  if (
    !Array.isArray(values) ||
    !Array.isArray(identities) ||
    values.length === 0 ||
    values.length > MAX_LINES ||
    values.length !== identities.length
  ) {
    return null
  }
  const lines: ArchivedBuildertrendChangeOrderLine[] = []
  for (let index = 0; index < values.length; index += 1) {
    const line = values[index]
    const identity = identities[index]
    if (!Array.isArray(line) || line.length !== 4 || !object(identity)) return null
    const costCodeDisplay = boundedString(line[0], 500)
    const unitCostDisplay = boundedString(line[1], 120)
    const quantityDisplay = boundedString(line[2], 120)
    const clientPriceDisplay = boundedString(line[3], 120)
    const lineNumber = positiveInteger(identity.displayOrder)
    const sourceLineId = boundedString(identity.sourceLineIdFromRowKey, 200)
    const identityCostCode = boundedString(identity.displayedCostCode, 500)
    const identityPrice = boundedString(identity.displayedClientPrice, 120)
    const identityTitle = boundedString(identity.displayedTitle, 500)
    if (
      !costCodeDisplay ||
      !unitCostDisplay ||
      !quantityDisplay ||
      !clientPriceDisplay ||
      lineNumber !== index + 1 ||
      !sourceLineId ||
      identityCostCode !== costCodeDisplay ||
      identityPrice !== clientPriceDisplay
    ) {
      return null
    }
    lines.push({
      id: `${sourceRecordId}:${sourceLineId}`,
      lineNumber,
      description: identityTitle && identityTitle !== "--" ? identityTitle : `Line ${lineNumber}`,
      costCodeDisplay,
      unitCostDisplay,
      quantityDisplay,
      clientPriceDisplay,
    })
  }
  return lines
}

function parseActivity(
  expandedActivity: Readonly<Record<string, unknown>>,
  sourceRecordId: string
): readonly ArchivedBuildertrendChangeOrderActivity[] | null {
  const values = expandedActivity.events
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ACTIVITY) {
    return null
  }
  const activity: ArchivedBuildertrendChangeOrderActivity[] = []
  for (const value of values) {
    if (!object(value)) return null
    const displayOrder = positiveInteger(value.displayOrder)
    const kind = boundedString(value.kind, 120)
    const actor = boundedString(value.actor, 300)
    const displayedAt = boundedString(value.displayedAt, 300)
    if (!displayOrder || !kind || !ALLOWED_ACTIVITY_KINDS.has(kind) || !actor || !displayedAt) {
      return null
    }
    activity.push({
      id: `${sourceRecordId}:activity:${displayOrder}`,
      displayOrder,
      kind,
      actor,
      displayedAt,
      details: activityDetails(value),
    })
  }
  return activity.sort((left, right) => left.displayOrder - right.displayOrder)
}

function archiveEvidence(
  row: BuildertrendArchiveSourceRow,
  payload: Readonly<Record<string, unknown>>
): ArchivedBuildertrendEvidence {
  const checksum = boundedString(payload.sourceArchiveSha256, 64)
  const driveFileId = boundedString(payload.driveFileId, 200)
  const stagingRawPayload = object(payload.stagingRawPayload)
    ? payload.stagingRawPayload
    : null
  const archive = stagingRawPayload && object(stagingRawPayload.archive)
    ? stagingRawPayload.archive
    : null
  const archivedFileId = archive ? boundedString(archive.driveFileId, 200) : null
  const archivedUrl = archive ? boundedString(archive.driveUrl, 2_048) : null
  if (
    !checksum ||
    !SHA256.test(checksum) ||
    !driveFileId ||
    !DRIVE_FILE_ID.test(driveFileId) ||
    row.verifiedArchiveDriveFileId !== driveFileId ||
    archivedFileId !== driveFileId ||
    !row.verifiedArchiveDriveUrl ||
    archivedUrl !== row.verifiedArchiveDriveUrl ||
    !exactDriveUrl(row.verifiedArchiveDriveUrl, driveFileId)
  ) {
    return {
      status: "held",
      reason: "Verified Drive archive evidence is incomplete or does not match the immutable observation.",
    }
  }
  return {
    status: "verified",
    driveFileId,
    driveUrl: row.verifiedArchiveDriveUrl,
    sha256: checksum,
  }
}

function manifestEvidence(
  payload: Readonly<Record<string, unknown>>
): ArchivedBuildertrendManifestEvidence {
  if (!object(payload.provenanceManifest)) {
    return {
      status: "held",
      reason: "Provenance manifest publication is held and has not been verified.",
    }
  }
  const driveFileId = boundedString(payload.provenanceManifest.driveFileId, 200)
  const driveUrl = boundedString(payload.provenanceManifest.driveUrl, 2_048)
  const checksum = boundedString(payload.provenanceManifest.sha256, 64)
  const status = boundedString(payload.provenanceManifest.status, 40)
  if (
    status !== "verified" ||
    !driveFileId ||
    !DRIVE_FILE_ID.test(driveFileId) ||
    !driveUrl ||
    !exactDriveUrl(driveUrl, driveFileId) ||
    !checksum ||
    !SHA256.test(checksum)
  ) {
    return {
      status: "held",
      reason: "Provenance manifest evidence is present but not verified.",
    }
  }
  return { status: "verified", driveFileId, driveUrl, sha256: checksum }
}

export function parseArchivedBuildertrendChangeOrder(input: {
  readonly projectId: string
  readonly buildertrendJobId: string
  readonly row: BuildertrendArchiveSourceRow
  readonly observation: BuildertrendArchiveObservationRow
}): ArchivedBuildertrendChangeOrderParseResult {
  const { row, observation } = input
  const held = (reason: string): ArchivedBuildertrendChangeOrderParseResult => ({
    kind: "held",
    sourceRecordId: row.id,
    reason,
  })
  if (
    row.projectId !== input.projectId ||
    row.requestedProjectId !== input.projectId ||
    row.sourceRecordType !== "change_order" ||
    row.reviewStatus !== "verified" ||
    row.promotionStatus !== "archive_only" ||
    row.buildertrendJobId !== input.buildertrendJobId ||
    !row.buildertrendRecordId ||
    !row.buildertrendRecordNumber ||
    !row.buildertrendUrl ||
    !row.sourceStatus
  ) {
    return held("The staged source identity or archive-only review state needs reconciliation.")
  }
  if (
    observation.organizationId !== row.organizationId ||
    observation.entityKind !== "record" ||
    observation.entityKey !== row.sourceKey ||
    observation.entityId !== row.id
  ) {
    return held("Matching immutable source evidence is not available.")
  }
  const parsed = parseJson(observation.observedPayloadJson)
  if (!object(parsed)) return held("The immutable source evidence is unreadable or exceeds safety bounds.")
  const sourceKey = boundedString(parsed.sourceKey, 1_000)
  const sourceStatus = boundedString(parsed.sourceStatus, 200)
  const sourceRecord = object(parsed.sourceRecord) ? parsed.sourceRecord : null
  const sourceLineIdentity = object(parsed.sourceLineIdentity)
    ? parsed.sourceLineIdentity
    : null
  const expandedActivity = object(parsed.expandedActivity)
    ? parsed.expandedActivity
    : null
  if (
    sourceKey !== row.sourceKey ||
    sourceStatus !== row.sourceStatus ||
    !sourceRecord ||
    !sourceLineIdentity ||
    !expandedActivity
  ) {
    return held("The immutable source payload does not match the staged record.")
  }
  const sourceId = boundedString(sourceRecord.sourceId, 200)
  const number = boundedString(sourceRecord.number, 200)
  const title = boundedString(sourceRecord.title, 500)
  const sourceUrl = boundedString(sourceRecord.sourceUrl, 2_048)
  const scope = boundedString(sourceRecord.sourceScope, 20_000)
  const listStatus = boundedString(sourceRecord.listStatus, 100)
  const detailStatus = boundedString(sourceRecord.detailStatus, 100)
  const statusLabel =
    listStatus && detailStatus
      ? displayStatus(row.sourceStatus, listStatus, detailStatus)
      : null
  if (
    sourceId !== row.buildertrendRecordId ||
    number !== row.buildertrendRecordNumber ||
    title !== row.title ||
    sourceUrl !== row.buildertrendUrl ||
    !exactBuildertrendUrl(row.buildertrendUrl, row.buildertrendRecordId, input.buildertrendJobId) ||
    !scope ||
    !statusLabel
  ) {
    return held("The captured change-order identity or source status needs reconciliation.")
  }
  if (
    boundedString(sourceLineIdentity.buildertrendChangeOrderId, 200) !== sourceId ||
    boundedString(sourceLineIdentity.number, 200) !== number ||
    boundedString(sourceLineIdentity.url, 2_048) !== sourceUrl ||
    boundedString(expandedActivity.buildertrendChangeOrderId, 200) !== sourceId ||
    boundedString(expandedActivity.buildertrendJobId, 200) !== input.buildertrendJobId ||
    boundedString(expandedActivity.sourceUrl, 2_048) !== sourceUrl
  ) {
    return held("The captured line or activity identity does not match the source record.")
  }
  const lines = parseLines(sourceRecord, sourceLineIdentity, sourceId)
  const activity = parseActivity(expandedActivity, sourceId)
  if (!lines || !activity) {
    return held("Captured lines or source activity are incomplete, unsupported, or exceed safety bounds.")
  }
  const decision = object(parsed.decision) ? parsed.decision : null
  const stagingRawPayload = object(parsed.stagingRawPayload)
    ? parsed.stagingRawPayload
    : null
  const contractSemantics = stagingRawPayload && object(stagingRawPayload.contractSemantics)
    ? stagingRawPayload.contractSemantics
    : null
  const purpose =
    decision &&
    boundedString(decision.sourcePurpose, 100) === "variance" &&
    contractSemantics &&
    boundedString(contractSemantics.purpose, 100) === "variance" &&
    contractSemantics.requesterEstablishedBySource === false &&
    contractSemantics.approvalActorIsRequester === false
      ? "Variance"
      : "Not classified"
  const approvalActor = activity.find((event) => event.kind === "Approved")?.actor ?? null
  return {
    kind: "record",
    record: {
      kind: "buildertrend_archive",
      id: row.id,
      projectId: input.projectId,
      sourceRecordId: sourceId,
      changeOrderNumber: number,
      title,
      scope,
      sourceStatus: row.sourceStatus,
      displayStatus: statusLabel,
      purpose,
      requester: "Unknown — not established by source",
      approvalActor,
      ownerRequested: false,
      budgetActive: false,
      lines,
      activity,
      archiveEvidence: archiveEvidence(row, parsed),
      manifestEvidence: manifestEvidence(parsed),
      observedAt: observation.observedAt,
      updatedAt: row.updatedAt,
    },
  }
}
