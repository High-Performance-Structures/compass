// Pure planning for scripts/saved-views-backfill.mjs: decides which legacy
// saved views and default-view preferences to copy into saved_views and
// saved_view_defaults (migration 0282), and builds the INSERT statements.
// No database access here, so the rules can be tested on plain fixtures.

/** Legacy table per saved_views scope. */
export const LEGACY_VIEW_TABLES = Object.freeze({
  projects: "project_saved_views",
  schedule: "schedule_saved_views",
})

/** user_view_preferences keys that hold a default view, per scope (`<prefix><organization id>`). */
export const LEGACY_DEFAULT_KEY_PREFIXES = Object.freeze({
  projects: "project-hub-default:",
})

/** D1 allows at most 100 bound values per statement; inserts stay inside that budget. */
export const D1_MAX_VALUES_PER_STATEMENT = 100

const VISIBILITIES = new Set(["personal", "shared"])

export const VIEW_COLUMNS = Object.freeze([
  "id", "organization_id", "owner_user_id", "scope", "name", "visibility", "definition", "created_at", "updated_at",
])
export const DEFAULT_COLUMNS = Object.freeze([
  "user_id", "organization_id", "scope", "view_id", "inline_definition", "updated_at",
])

function nameKey(row) {
  return JSON.stringify([row.organization_id, row.owner_user_id, row.scope, row.name])
}

function sameView(left, right) {
  return ["organization_id", "owner_user_id", "scope", "name", "visibility", "definition"].every((column) => left[column] === right[column])
}

/**
 * @param {object} input
 * @param {ReadonlyArray<object>} input.legacyViews rows of both legacy tables, each with a `scope`
 * @param {ReadonlyArray<object>} input.existingViews saved_views rows
 * @param {ReadonlyArray<object>} input.legacyDefaults user_view_preferences rows with a default-view key
 * @param {ReadonlyArray<object>} input.existingDefaults saved_view_defaults keys (user_id, organization_id, scope)
 * @param {ReadonlyArray<string>} input.organizationIds every organization id
 */
export function planSavedViewsBackfill({ legacyViews, existingViews, legacyDefaults, existingDefaults, organizationIds }) {
  const review = []
  const viewInserts = []
  const viewsAlreadyCopied = []
  const existingById = new Map(existingViews.map((row) => [row.id, row]))
  const takenNames = new Map(existingViews.map((row) => [nameKey(row), row.id]))
  const legacyIdCounts = new Map()
  for (const row of legacyViews) legacyIdCounts.set(row.id, (legacyIdCounts.get(row.id) ?? 0) + 1)

  for (const row of legacyViews) {
    const existing = existingById.get(row.id)
    if (existing) {
      if (sameView(existing, row)) viewsAlreadyCopied.push(row.id)
      else review.push({ kind: "view", reason: "saved_views already has this id with different values", legacy: row, existing })
      continue
    }
    if ((legacyIdCounts.get(row.id) ?? 0) > 1) {
      review.push({ kind: "view", reason: "the same id is in both legacy tables", legacy: row })
      continue
    }
    if (!VISIBILITIES.has(row.visibility)) {
      review.push({ kind: "view", reason: `visibility '${row.visibility}' is not personal or shared (never shown)`, legacy: row })
      continue
    }
    const key = nameKey(row)
    const holder = takenNames.get(key)
    if (holder !== undefined) {
      review.push({ kind: "view", reason: `name collides with saved view ${holder} for the same owner, organization and scope`, legacy: row })
      continue
    }
    takenNames.set(key, row.id)
    viewInserts.push(Object.fromEntries(VIEW_COLUMNS.map((column) => [column, row[column]])))
  }

  const organizations = new Set(organizationIds)
  const existingDefaultKeys = new Set(existingDefaults.map((row) => JSON.stringify([row.user_id, row.organization_id, row.scope])))
  const defaultInserts = []
  const defaultsAlreadyPresent = []
  for (const row of legacyDefaults) {
    const scopeEntry = Object.entries(LEGACY_DEFAULT_KEY_PREFIXES).find(([, prefix]) => row.view_key.startsWith(prefix))
    if (!scopeEntry) continue
    const [scope, prefix] = scopeEntry
    const organizationId = row.view_key.slice(prefix.length)
    if (!organizations.has(organizationId)) {
      review.push({ kind: "default", reason: "the organization in the preference key does not exist", legacy: row })
      continue
    }
    const key = JSON.stringify([row.user_id, organizationId, scope])
    // A row written since deploy is newer than the preference it mirrors.
    if (existingDefaultKeys.has(key)) {
      defaultsAlreadyPresent.push({ user_id: row.user_id, organization_id: organizationId, scope })
      continue
    }
    existingDefaultKeys.add(key)
    defaultInserts.push({
      user_id: row.user_id,
      organization_id: organizationId,
      scope,
      view_id: null,
      // Copied verbatim: the reader already treats a malformed value as the built-in view.
      inline_definition: row.value,
      updated_at: row.updated_at,
    })
  }

  return { viewInserts, viewsAlreadyCopied, defaultInserts, defaultsAlreadyPresent, review }
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

/**
 * Multi-row INSERTs, each within the D1 per-statement value budget. ON
 * CONFLICT DO NOTHING makes a re-run a no-op, so the script is idempotent.
 */
export function insertStatements(table, columns, rows) {
  const perStatement = Math.max(1, Math.floor(D1_MAX_VALUES_PER_STATEMENT / columns.length))
  const statements = []
  for (let start = 0; start < rows.length; start += perStatement) {
    const values = rows
      .slice(start, start + perStatement)
      .map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`)
    statements.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")} ON CONFLICT DO NOTHING;`)
  }
  return statements
}
