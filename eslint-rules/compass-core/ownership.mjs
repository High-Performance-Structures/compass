// Shared lookups for the compass-core lint rules: which domain module owns
// each table (src/lib/domain/table-ownership.json), which file is being
// linted, and whether an import path points at a Drizzle schema module.
import { readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const MANIFEST_PATH = "src/lib/domain/table-ownership.json"
const ROLE_LIST_PATH = "src/lib/domain/identity/statuses.ts"

export const DOCS = "docs/development/architecture-standards.md (section 1a)"

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_PATH), "utf8"))

/** Drizzle export name -> { module, path, hint, sqlName } */
export const OWNED_TABLES = new Map()
/** SQL table name -> Drizzle export name */
export const OWNED_SQL_NAMES = new Map()

for (const [module, entry] of Object.entries(manifest.modules)) {
  for (const [exportName, sqlName] of Object.entries(entry.tables)) {
    OWNED_TABLES.set(exportName, { module, path: entry.path, hint: entry.hint, sqlName })
    OWNED_SQL_NAMES.set(sqlName, exportName)
  }
}

export const ROLE_RULES = manifest.roles

// The role list is read from its single source rather than repeated here.
// "owner" is the project-audience alias for "client".
function loadRoleLiterals() {
  const text = readFileSync(join(REPO_ROOT, ROLE_LIST_PATH), "utf8")
  const list = text.match(/export const USER_ROLES = \[([\s\S]*?)\]/)
  if (!list) throw new Error(`compass-core: USER_ROLES not found in ${ROLE_LIST_PATH}`)
  const roles = [...list[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1])
  return new Set([...roles, "owner", "integration"])
}

export const ROLE_LITERALS = loadRoleLiterals()

/** Repo-relative, forward-slash path of the file being linted. */
export function lintedPath(context) {
  const cwd = context.cwd ?? REPO_ROOT
  return relative(cwd, context.filename).split(sep).join("/")
}

/** src/db defines the tables; it may reference every one of them. */
export function isSchemaHome(path) {
  return path.startsWith("src/db/")
}

export function isInsideOwner(path, table) {
  return isSchemaHome(path) || path.startsWith(`${table.path}/`)
}

/** True when an import source resolves to src/db/schema or src/db/schema-*. */
export function isSchemaModule(source, context) {
  if (typeof source !== "string") return false
  if (/^@\/db\/schema(?:-[a-z0-9-]+)?$/.test(source)) return true
  if (!source.startsWith(".")) return false
  const cwd = context.cwd ?? REPO_ROOT
  const target = relative(cwd, resolve(dirname(context.filename), source)).split(sep).join("/")
  return /^src\/db\/schema(?:-[a-z0-9-]+)?(?:\.ts)?$/.test(target)
}

/** The agent-facing message body shared by every table rule. */
export function ownershipMessage(exportName, table, how) {
  return [
    `\`${exportName}\` (${table.sqlName}) is owned by ${table.path}. Do not ${how} it here.`,
    `  -> ${table.hint}`,
    `If nothing fits, add a function to ${table.path}/ and call it. Do not disable this rule; see ${DOCS}.`,
  ].join("\n")
}
