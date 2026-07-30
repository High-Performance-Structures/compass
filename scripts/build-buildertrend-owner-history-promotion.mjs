import { writeFile } from "node:fs/promises"

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

const [outputPath, projectId, buildertrendJobId, ...participantTerms] =
  process.argv.slice(2)

if (
  !outputPath ||
  !projectId ||
  !buildertrendJobId ||
  participantTerms.length === 0
) {
  throw new Error(
    "Usage: node scripts/build-buildertrend-owner-history-promotion.mjs " +
      "<output.sql> <project-id> <buildertrend-job-id> <participant> [participant...]"
  )
}

const archiveChannelId = `bt-message-archive-${buildertrendJobId}`
const ownerChannelId = `project-owner-${projectId}`
const participantFilter = participantTerms
  .map(
    (term) =>
      `lower(source.content) LIKE ${sql(`%${term.trim().toLowerCase()}%`)}`
  )
  .join(" OR ")

const statement = `
-- Promote only Buildertrend messages that identify an approved owner
-- participant. The staff archive remains unchanged.
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
  'bt-owner-history-${buildertrendJobId}-' ||
    replace(source.id, 'bt-message-${buildertrendJobId}-', ''),
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
WHERE source.channel_id = ${sql(archiveChannelId)}
  AND (${participantFilter})
ON CONFLICT(id) DO UPDATE SET
  content = excluded.content,
  content_html = excluded.content_html,
  created_at = excluded.created_at;
`.trimStart()

await writeFile(outputPath, statement, "utf8")

console.log(
  JSON.stringify({
    outputPath,
    projectId,
    archiveChannelId,
    ownerChannelId,
    participantTerms,
  })
)
