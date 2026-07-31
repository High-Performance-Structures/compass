import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

const MANIFEST_SCHEMA_VERSION = 1
const OWNER_VISIBLE_DECISION = "owner_visible"
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`)
  }
  return value.trim()
}

function requireSafeIdentifier(value, fieldName) {
  const identifier = requireNonEmptyString(value, fieldName)
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `${fieldName} may contain only letters, numbers, periods, colons, underscores, and hyphens`
    )
  }
  return identifier
}

function requireReviewTimestamp(value) {
  const reviewedAt = requireNonEmptyString(value, "reviewedAt")
  if (!Number.isFinite(Date.parse(reviewedAt))) {
    throw new Error("reviewedAt must be an ISO-8601 timestamp")
  }
  return reviewedAt
}

export function parseReviewManifest(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("review manifest must be a JSON object")
  }

  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}; refusing an unknown review contract`
    )
  }
  if (value.reviewDecision !== OWNER_VISIBLE_DECISION) {
    throw new Error(
      `reviewDecision must be ${OWNER_VISIBLE_DECISION}; ambiguous rows remain quarantined`
    )
  }

  const projectId = requireSafeIdentifier(value.projectId, "projectId")
  const buildertrendJobId = requireSafeIdentifier(
    value.buildertrendJobId,
    "buildertrendJobId"
  )
  const reviewedAt = requireReviewTimestamp(value.reviewedAt)
  const reviewedBy = requireNonEmptyString(value.reviewedBy, "reviewedBy")

  if (!Array.isArray(value.sourceMessageIds)) {
    throw new Error("sourceMessageIds must be an array")
  }

  const expectedPrefix = `bt-message-${buildertrendJobId}-`
  const sourceMessageIds = value.sourceMessageIds.map((candidate, index) => {
    const sourceMessageId = requireSafeIdentifier(
      candidate,
      `sourceMessageIds[${index}]`
    )
    if (
      !sourceMessageId.startsWith(expectedPrefix) ||
      sourceMessageId.length === expectedPrefix.length
    ) {
      throw new Error(
        `sourceMessageIds[${index}] must identify a message from Buildertrend job ${buildertrendJobId}`
      )
    }
    return sourceMessageId
  })

  if (new Set(sourceMessageIds).size !== sourceMessageIds.length) {
    throw new Error("sourceMessageIds must not contain duplicates")
  }

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    reviewDecision: OWNER_VISIBLE_DECISION,
    projectId,
    buildertrendJobId,
    reviewedAt,
    reviewedBy,
    sourceMessageIds,
  }
}

function promotedMessageId(buildertrendJobId, sourceMessageId) {
  return `bt-owner-history-${buildertrendJobId}-${sourceMessageId.slice(
    `bt-message-${buildertrendJobId}-`.length
  )}`
}

function sqlCommentValue(value) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ")
}

export function buildPromotionStatement(manifest) {
  const archiveChannelId = `bt-message-archive-${manifest.buildertrendJobId}`
  const ownerChannelId = `project-owner-${manifest.projectId}`
  const sourcePrefix = `bt-message-${manifest.buildertrendJobId}-`
  const promotedPrefix = `bt-owner-history-${manifest.buildertrendJobId}-`
  const sourceMessageIdList =
    manifest.sourceMessageIds.length > 0
      ? manifest.sourceMessageIds.map(sql).join(",\n    ")
      : null
  const promotedMessageIds = manifest.sourceMessageIds.map((sourceMessageId) =>
    promotedMessageId(manifest.buildertrendJobId, sourceMessageId)
  )
  const retainedPromotionClause =
    promotedMessageIds.length > 0
      ? `\n  AND id NOT IN (\n    ${promotedMessageIds.map(sql).join(",\n    ")}\n  )`
      : ""
  const reviewedSourceClause =
    sourceMessageIdList === null
      ? "  AND 0 = 1"
      : `  AND source.id IN (\n    ${sourceMessageIdList}\n  )`

  return `
-- Buildertrend owner-history promotion review
-- project: ${manifest.projectId}
-- Buildertrend job: ${manifest.buildertrendJobId}
-- reviewed by: ${sqlCommentValue(manifest.reviewedBy)}
-- reviewed at: ${manifest.reviewedAt}
-- reviewed source records: ${manifest.sourceMessageIds.length}
--
-- This reconciliation is intentionally silent. It writes no notification,
-- mention, email, SMS, or unread-state records. Unreviewed source messages
-- remain quarantined in the staff-only Buildertrend archive. Apply this whole
-- file as one D1 batch; the source archive remains the recovery authority.

-- Remove any earlier owner-channel promotion that is not in this exact,
-- explicitly reviewed set. The source archive rows are never deleted.
DELETE FROM messages
WHERE channel_id = ${sql(ownerChannelId)}
  AND substr(id, 1, ${promotedPrefix.length}) = ${sql(promotedPrefix)}${retainedPromotionClause}
  AND EXISTS (
    SELECT 1
    FROM channels AS target_channel
    WHERE target_channel.id = ${sql(ownerChannelId)}
      AND target_channel.project_id = ${sql(manifest.projectId)}
      AND target_channel.audience = 'clients'
  );

-- Copy only reviewed source record IDs. Channel/project/organization checks
-- prevent a valid-looking ID from crossing project or organization boundaries.
INSERT INTO messages (
  id,
  channel_id,
  thread_id,
  user_id,
  content,
  content_html,
  edited_at,
  deleted_at,
  deleted_by,
  is_pinned,
  reply_count,
  last_reply_at,
  created_at
)
SELECT
  ${sql(promotedPrefix)} ||
    substr(source.id, ${sourcePrefix.length + 1}),
  ${sql(ownerChannelId)},
  NULL,
  source.user_id,
  source.content,
  source.content_html,
  NULL,
  NULL,
  NULL,
  0,
  0,
  NULL,
  source.created_at
FROM messages AS source
INNER JOIN channels AS archive_channel
  ON archive_channel.id = source.channel_id
INNER JOIN channels AS target_channel
  ON target_channel.id = ${sql(ownerChannelId)}
WHERE source.channel_id = ${sql(archiveChannelId)}
${reviewedSourceClause}
  AND archive_channel.project_id = ${sql(manifest.projectId)}
  AND archive_channel.audience = 'organization'
  AND target_channel.project_id = ${sql(manifest.projectId)}
  AND target_channel.audience = 'clients'
  AND target_channel.organization_id = archive_channel.organization_id
ON CONFLICT(id) DO UPDATE SET
  content = excluded.content,
  content_html = excluded.content_html,
  created_at = excluded.created_at
WHERE messages.channel_id = excluded.channel_id;
`.trimStart()
}

async function main() {
  const [outputPath, manifestPath, ...unexpectedArguments] =
    process.argv.slice(2)

  if (!outputPath || !manifestPath || unexpectedArguments.length > 0) {
    throw new Error(
      "Usage: node scripts/build-buildertrend-owner-history-promotion.mjs " +
        "<output.sql> <review-manifest.json>"
    )
  }

  const manifest = parseReviewManifest(
    JSON.parse(await readFile(manifestPath, "utf8"))
  )
  const statement = buildPromotionStatement(manifest)
  await writeFile(outputPath, statement, "utf8")

  console.log(
    JSON.stringify({
      outputPath,
      projectId: manifest.projectId,
      archiveChannelId: `bt-message-archive-${manifest.buildertrendJobId}`,
      ownerChannelId: `project-owner-${manifest.projectId}`,
      reviewedSourceMessageCount: manifest.sourceMessageIds.length,
      quarantinePolicy: "unreviewed_archive_only",
      notificationPolicy: "silent_reconciliation",
    })
  )
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
