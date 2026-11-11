// Blocks importing (or re-exporting) a Core-owned table outside its owning
// domain module. Drizzle needs the table object to query it, so this rule
// stops most out-of-place reads and writes at the import line.
// Type-only imports are allowed: a row type carries no data access.
import { isInsideOwner, isSchemaHome, isSchemaModule, lintedPath, OWNED_TABLES, ownershipMessage } from "./ownership.mjs"

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Core-owned tables are imported only by their owning domain module" },
    schema: [],
  },
  create(context) {
    const path = lintedPath(context)

    function checkSpecifier(node, exportName, isTypeOnly) {
      if (isTypeOnly) return
      const table = OWNED_TABLES.get(exportName)
      if (!table || isInsideOwner(path, table)) return
      context.report({ node, message: ownershipMessage(exportName, table, "import") })
    }

    return {
      ImportDeclaration(node) {
        if (!isSchemaModule(node.source.value, context)) return
        const declarationTypeOnly = node.importKind === "type"
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue
          const name = specifier.imported.name ?? specifier.imported.value
          checkSpecifier(specifier, name, declarationTypeOnly || specifier.importKind === "type")
        }
      },
      ExportNamedDeclaration(node) {
        if (!node.source || !isSchemaModule(node.source.value, context)) return
        const declarationTypeOnly = node.exportKind === "type"
        for (const specifier of node.specifiers) {
          const name = specifier.local.name ?? specifier.local.value
          checkSpecifier(specifier, name, declarationTypeOnly || specifier.exportKind === "type")
        }
      },
      ExportAllDeclaration(node) {
        if (isSchemaHome(path) || !isSchemaModule(node.source.value, context)) return
        context.report({
          node,
          message: "Do not re-export a schema module outside src/db: it hands out Core-owned tables. Export the specific functions you need from the owning domain module instead.",
        })
      },
    }
  },
}

export default rule
