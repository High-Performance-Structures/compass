// compass-core: mechanical enforcement of Core table ownership (issue #1329).
// Ownership is declared in src/lib/domain/table-ownership.json; the standard
// is docs/development/architecture-standards.md (section 1a).
import noDisableDirective from "./no-disable-directive.mjs"
import noSchemaNamespaceImport from "./no-schema-namespace-import.mjs"
import ownedTableImport from "./owned-table-import.mjs"
import ownedTableRawSql from "./owned-table-raw-sql.mjs"
import ownedTableRelationalQuery from "./owned-table-relational-query.mjs"
import roleLiteralCompare from "./role-literal-compare.mjs"

export const CORE_RULES = {
  "owned-table-import": ownedTableImport,
  "no-schema-namespace-import": noSchemaNamespaceImport,
  "owned-table-relational-query": ownedTableRelationalQuery,
  "owned-table-raw-sql": ownedTableRawSql,
  "role-literal-compare": roleLiteralCompare,
  "no-disable-directive": noDisableDirective,
}

const plugin = {
  meta: { name: "compass-core" },
  rules: CORE_RULES,
}

export default plugin
