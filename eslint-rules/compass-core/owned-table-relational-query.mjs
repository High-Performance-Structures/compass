// Closes the relational-query loophole: `db.query.projectMembers.findMany()`
// reaches a table through the Drizzle schema object without importing it.
import { isInsideOwner, lintedPath, OWNED_TABLES, ownershipMessage } from "./ownership.mjs"

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "No db.query.<ownedTable> outside the owning domain module" },
    schema: [],
  },
  create(context) {
    const path = lintedPath(context)
    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== "Identifier") return
        const owner = node.object
        if (owner.type !== "MemberExpression" || owner.computed) return
        if (owner.property.type !== "Identifier" || owner.property.name !== "query") return
        const table = OWNED_TABLES.get(node.property.name)
        if (!table || isInsideOwner(path, table)) return
        context.report({ node, message: ownershipMessage(node.property.name, table, "query") })
      },
    }
  },
}

export default rule
