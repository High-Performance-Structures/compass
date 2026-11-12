// Role logic lives in one place. Comparing a role against a literal
// (`role === "client"`, `["admin", "office"].includes(user.role)`,
// `case "subcontractor":`) outside that place re-implements it and drifts.
import { lintedPath, ROLE_LITERALS, ROLE_RULES } from "./ownership.mjs"

const MESSAGE = [
  "Do not compare roles against literals here; role logic has one home.",
  `  -> ${ROLE_RULES.hint}`,
  "Do not disable this rule; see docs/development/architecture-standards.md (section 1a).",
].join("\n")

// Google Calendar's ACL `accessRole` ("owner", "writer") is not a Compass role.
function isRoleName(name) {
  return /role$/i.test(name) && !/accessRole$/i.test(name)
}

function isRoleExpression(node) {
  if (!node) return false
  if (node.type === "ChainExpression") return isRoleExpression(node.expression)
  if (node.type === "Identifier") return isRoleName(node.name)
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return isRoleName(node.property.name)
  }
  return false
}

function isRoleLiteral(node) {
  return node?.type === "Literal" && typeof node.value === "string" && ROLE_LITERALS.has(node.value)
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "No literal role comparisons outside the identity domain" },
    schema: [],
  },
  create(context) {
    const path = lintedPath(context)
    if (ROLE_RULES.allowedPaths.some((allowed) => path === allowed || path.startsWith(allowed))) return {}

    return {
      BinaryExpression(node) {
        if (!["===", "!==", "==", "!="].includes(node.operator)) return
        const pairs = [
          [node.left, node.right],
          [node.right, node.left],
        ]
        if (pairs.some(([a, b]) => isRoleExpression(a) && isRoleLiteral(b))) context.report({ node, message: MESSAGE })
      },
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "includes") return
        if (callee.object.type !== "ArrayExpression" || !isRoleExpression(node.arguments[0])) return
        if (callee.object.elements.some(isRoleLiteral)) context.report({ node, message: MESSAGE })
      },
      SwitchCase(node) {
        if (isRoleLiteral(node.test) && isRoleExpression(node.parent.discriminant)) {
          context.report({ node, message: MESSAGE })
        }
      },
    }
  },
}

export default rule
