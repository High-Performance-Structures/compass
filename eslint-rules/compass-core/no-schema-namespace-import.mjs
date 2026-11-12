// Closes the namespace loophole: `import * as schema` (or a dynamic import)
// would reach Core-owned tables as `schema.projectMembers` without naming
// them in the import line.
import { isSchemaHome, isSchemaModule, lintedPath } from "./ownership.mjs"

const MESSAGE =
  "Import the specific tables you need from the schema, not the whole module. Namespace and dynamic schema imports are allowed only in src/db (they bypass Core table ownership)."

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "No namespace or dynamic schema imports outside src/db" },
    schema: [],
  },
  create(context) {
    if (isSchemaHome(lintedPath(context))) return {}
    return {
      ImportNamespaceSpecifier(node) {
        if (isSchemaModule(node.parent.source.value, context)) context.report({ node, message: MESSAGE })
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && isSchemaModule(node.source.value, context)) {
          context.report({ node, message: MESSAGE })
        }
      },
    }
  },
}

export default rule
