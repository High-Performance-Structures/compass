# Compass Help Authoring

The Markdown files in `docs/help/guides/` are the canonical source for Compass user guidance. The in-app library, contextual help, search, and Jarvis grounding must all consume the generated registry rather than maintaining separate explanations.

## Update contract

When a user-visible workflow, label, permission, route, status, or safety rule changes:

1. Update the affected guide in the same pull request.
2. Keep its `id` and explicit section anchors stable. Other code may link to them.
3. Update `lastReviewed` after verifying the guide against the working product.
4. Run `bun run help:generate` and commit the generated registry.
5. Run `bun run help:check` before merging.

`bun run help:check` validates required metadata, audience and permission values, duplicate IDs, explicit anchors, registered routes, the minimum guide set, generated-file freshness, and a 180-day maximum review age. This command is suitable for CI and intentionally fails when the canonical Markdown changes without regeneration or a guide goes too long without human verification.

## Metadata

Each guide begins with JSON frontmatter. JSON keeps generation deterministic without adding a YAML parser. Required fields are:

- `id`: stable dot-separated guide topic ID;
- `featureId`: permission feature whose effective read access gates the guide;
- `slug`: stable URL segment;
- `title`, `summary`, and `contextSummary`: library, search, and contextual-help copy;
- `category` and `tags`: discovery metadata;
- `audiences`: any of `staff`, `owner`, `subcontractor`, `supplier`, or `guest`;
- `permissions`: baseline resource/action requirements used for metadata and
  validation; server authorization also requires effective access to
  `featureId`, including organization and team overrides;
- `routes`: real `/dashboard` or external-audience `/preview` App Router pages
  where the guide is relevant; routes must be canonical pathnames without a
  query, fragment, trailing slash, or `.` / `..` segment;
- `owner`: team responsible for accuracy; and
- `lastReviewed`: verified date in `YYYY-MM-DD` form.

Every level-two heading must include a stable explicit anchor:

```markdown
## Critical Path {#critical-path}
```

That section's topic ID becomes `<guide-id>.<anchor>`, such as `schedule.critical-path`, and its permanent in-app URL is `/dashboard/help/schedules-and-tasks#critical-path`. Changing the visible heading is safe; changing the ID or anchor is a breaking change.

## Editorial rules

- Explain the task in the language visible in Compass.
- Distinguish saving, approving, sharing, and synchronizing.
- Call out audience exposure, accounting, deletion, and duplicate-record risks.
- Describe role-dependent controls as conditional rather than promising every user sees them.
- Link to another in-app guide with `/dashboard/help/<slug>#<anchor>`.
- Do not depend on separately maintained PDFs. Browser printing can create a point-in-time copy when needed.
