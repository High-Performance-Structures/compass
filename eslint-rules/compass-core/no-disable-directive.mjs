// compass-core rules are never switched off inline. The on-site error here is
// backed by scripts/check-core-suppressions.mjs in CI, which a directive
// cannot silence.
const DIRECTIVE = /^\s*eslint(?:-disable(?:-next-line|-line)?|-enable)?\b/

const MESSAGE =
  "compass-core rules cannot be disabled inline. Move the table access into its owning domain module (src/lib/domain/<module>/) and call it. See docs/development/architecture-standards.md (section 1a)."

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "No eslint directives that disable compass-core rules" },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (DIRECTIVE.test(comment.value) && comment.value.includes("compass-core")) {
            context.report({ loc: comment.loc, message: MESSAGE })
          }
        }
      },
    }
  },
}

export default rule
