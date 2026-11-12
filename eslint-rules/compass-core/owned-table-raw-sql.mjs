// Closes the raw-SQL loophole: SQL text that names a Core-owned table
// outside its owning domain module.
//
// Outside an SQL context only UPPERCASE keywords count (`FROM users`), so UI
// prose such as "remove from users" never matches. Inside sql`...`, sql.raw(),
// .prepare(), .exec() and .raw(), keywords match in any case and quoted or
// snake_case table names match on their own.
import { isInsideOwner, lintedPath, OWNED_SQL_NAMES, OWNED_TABLES, ownershipMessage } from "./ownership.mjs"

const SQL_CALLS = new Set(["prepare", "exec", "raw"])
const names = [...OWNED_SQL_NAMES.keys()].join("|")
const KEYWORD = `\\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+[\`"\\[]?(${names})(?![a-z0-9_])`
const KEYWORD_UPPER = new RegExp(KEYWORD, "g")
const KEYWORD_ANY_CASE = new RegExp(KEYWORD, "gi")
const QUOTED = new RegExp(`[\`"](${names})[\`"]`, "g")
const SNAKE = new RegExp(`\\b(${[...OWNED_SQL_NAMES.keys()].filter((name) => name.includes("_")).join("|")})\\b`, "g")

function isSqlTag(tag) {
  if (tag.type === "Identifier") return tag.name === "sql"
  return tag.type === "MemberExpression" && tag.object.type === "Identifier" && tag.object.name === "sql"
}

function isSqlCall(node) {
  if (node?.type !== "CallExpression") return false
  const callee = node.callee
  return callee.type === "MemberExpression" && !callee.computed && SQL_CALLS.has(callee.property.name)
}

function inSqlContext(node) {
  const parent = node.parent
  if (node.type === "TemplateLiteral" && parent?.type === "TaggedTemplateExpression") return isSqlTag(parent.tag)
  return isSqlCall(parent) && parent.arguments.includes(node)
}

function firstOwnedName(text, sqlContext) {
  const patterns = sqlContext ? [KEYWORD_ANY_CASE, QUOTED, SNAKE] : [KEYWORD_UPPER]
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    const match = pattern.exec(text)
    if (match) return match[1].toLowerCase()
  }
  return null
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "No raw SQL against Core-owned tables outside the owning domain module" },
    schema: [],
  },
  create(context) {
    const path = lintedPath(context)

    function check(node, text) {
      const sqlName = firstOwnedName(text, inSqlContext(node))
      if (!sqlName) return
      const exportName = OWNED_SQL_NAMES.get(sqlName)
      const table = OWNED_TABLES.get(exportName)
      if (isInsideOwner(path, table)) return
      context.report({ node, message: ownershipMessage(exportName, table, "write SQL against") })
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value)
      },
      TemplateLiteral(node) {
        check(node, node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" ? "))
      },
    }
  },
}

export default rule
