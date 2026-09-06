# Compass Help System

Compass Help is a canonical, permission-aware user guide with contextual entry
points. It provides quick explanations in the product, searchable long-form
guides, and bounded source material for AI-assisted explanations. The same
version-controlled content must drive each experience so that search,
contextual help, Jarvis, and the external Help Assistant do not disagree.

## Architecture

The Markdown files in `docs/help/guides/` are the source of truth. Each guide
declares stable IDs, audience and permission metadata, applicable routes, an
owner, and a review date. `scripts/generate-help-resources.mjs` validates those
files and produces `src/lib/help/help-guides.generated.ts`.

Runtime responsibilities are deliberately separated:

- `src/lib/help/index.ts` exposes the canonical registry, search, route lookup,
  topic lookup, and audience helpers.
- `src/lib/help/server-access.ts` computes effective guide access from the
  authenticated user's role, RBAC permissions, and feature overrides. It is the
  authoritative runtime access decision.
- Server-rendered Help pages pass only approved guide previews into the client.
  Client-side search and contextual help operate on that already-filtered set.
- `src/lib/help/jarvis-context.ts` gives authorized internal Jarvis sessions a
  bounded slice of the same canonical content.
- `src/lib/help/assistant-context.ts` deterministically selects bounded,
  authorized guide sections and server-authored citations for the external
  Compass Help Assistant. It does not call a model or expose an API.

The generated registry is not an authorization boundary by itself. Any server
route that returns guide content or uses it for inference must first compute
effective access and pass only the resulting guide IDs to the relevant help
resolver. A browser-provided role, audience, permission, feature ID, or list of
allowed guides is never authoritative.

## Contextual Help and Deep Links

Every contextual beacon points to a stable section topic ID. A section topic ID
has the form `<guide-id>.<section-anchor>` and resolves to:

```text
/dashboard/help/<guide-slug>#<section-anchor>
```

The guide slug and section anchor may be changed only as an intentional link
migration. Prefer preserving them when editing titles or prose. Citations shown
by AI-assisted help are constructed by Compass from registry metadata; a model
must not choose, rewrite, or invent citation URLs.

## Internal Jarvis Grounding

Internal users who can use Jarvis receive canonical Help context only after the
same effective guide-access check used by the Help library. The resolver loads
at most a small number of relevant topics and enforces a character cap. Help
content supplements Jarvis's authorized tools and live project context; it does
not expand those permissions.

External users must not be routed through Jarvis. The Jarvis API can initialize
project-data tools, navigation, plugins, MCP clients, an agent token, and a
private relay. Hiding those controls in the UI is not sufficient isolation.

## Owner and Vendor Help Assistant Contract

The Compass Help Assistant is a separate, stateless assistant intended for
authenticated owners and approved project partners such as subcontractors and
suppliers. It explains the user guide only.

The product must describe this boundary plainly:

> Answers come only from the Compass user guide. The Help Assistant cannot see
> project data or take actions. Do not paste private project, account, or
> financial information.

When model execution is added, its server route must satisfy all of the
following requirements:

1. Authenticate the request and recompute effective Help access on every call.
2. Keep external Help access separate from the `agent` resource and
   `canUseAskCompass`. Enabling the Help Assistant must not enable Jarvis.
3. Accept only a bounded question and an optional canonical topic ID. Do not
   accept chat history, attachments, source text, role or audience claims,
   allowed guide IDs, provider selection, tool definitions, or model settings.
4. Resolve sources only through `resolveHelpAssistantContext`, using guide IDs
   obtained from `getEffectiveHelpGuideAccess` on the server.
5. Treat an inaccessible topic exactly like an unknown topic. Do not fall back
   to a different guide after an explicit inaccessible topic request.
6. Skip inference when no relevant authorized source exists. Return a stable
   not-covered response and a general Help-library action instead.
7. Use only the organization's server-managed provider configuration. Never use
   an external user's OAuth token or the private Jarvis relay.
8. Run one bounded model turn with no Compass tools, MCP manager, agent token,
   project data source, conversation memory, attachments, navigation, or action
   capability.
9. Instruct the model to answer only from clearly delimited canonical sources,
   say when the sources do not cover a detail, and never claim knowledge of live
   project or account state.
10. Return answer text separately from citations. Render only Compass-authored
    citation records and canonical deep links supplied by the resolver.
11. Apply a distributed per-organization and per-user rate limit before model
    execution, plus strict question, context, output-token, turn, and timeout
    limits. Do not automatically retry an inference request.
12. Set `Cache-Control: no-store`. Do not log raw questions, source excerpts, or
    answers. Operational metrics may record actor and organization identifiers,
    outcome, latency, and selected topic IDs under the normal retention policy.

If the provider is unavailable or returns no usable answer, the UI should say
that the Help Assistant is unavailable and preserve the authorized canonical
guide links. It must never fall through to Jarvis. Owners and project partners
should still be able to search and read guides when AI assistance is disabled.

## Threat Boundaries

### Authorization and topic enumeration

Guide visibility depends on role, required RBAC permissions, and effective
feature overrides. Filter the registry before reading source excerpts. Unknown
and forbidden canonical topic IDs receive the same external result so the Help
Assistant cannot be used to enumerate staff-only workflows.

### Tool and data privilege

The external assistant is a documentation explanation service, not an agent.
Its future route must not import or initialize the Compass MCP server, MCP client
manager, project query tools, navigation or rendering tools, plugins, agent
tokens, conversation storage, or the Jarvis relay. A prompt cannot grant a
capability that is absent from the execution environment.

### Prompt injection and unsupported answers

The user's question is untrusted. Canonical guide excerpts are trusted reference
content but are still delimited as data rather than prior conversation or user
instructions. The model receives a fixed instruction to use those excerpts
only, ignore conflicting instructions, and decline details the sources do not
cover. Deterministic source selection and server-authored citations remain
outside the model.

### Output and link safety

Render model output as escaped plain text or restricted, link-free Markdown.
Render citations from the structured resolver result. Do not render arbitrary
model-authored links or raw HTML.

### Cost, availability, and privacy

Authentication alone is not a cost control. Rate limits, size caps, one-turn
execution, output limits, and timeouts are required before launch. Do not send
the current project record, route identifiers containing project IDs, files, or
other live application data to the model. Avoid storing questions and answers;
the feature is stateless by design.

## Authoring and Operational Maintenance

When a UX label, permission, feature, route, or workflow changes:

1. Update the relevant file in `docs/help/guides/` in the same pull request.
2. Preserve stable guide IDs and section anchors whenever possible.
3. Update route, audience, permission, feature, owner, and `lastReviewed`
   metadata as needed.
4. Add or update contextual topic IDs where the UI changed.
5. Run `bun run help:generate` and review the generated diff.
6. Run `bun run help:check` before merging.
7. Verify the Help-library article, contextual deep link, search result, and any
   AI-assisted citation all resolve to the same canonical section.

`bun run help:check` validates metadata and generated-file freshness and runs
the maintenance tests that scan registered routes and contextual topic IDs. CI
runs the same command. The review-age limit is 180 days; guide owners should
review sooner after material UX, policy, or workflow changes. A passing age
check confirms recent review, not factual correctness, so feature reviewers
remain responsible for checking the prose against the implemented workflow.

New features are not complete when their discoverable workflow lacks Help
coverage. Reviewers should request a guide or an intentional update whenever a
new route, control, permission-dependent action, error recovery path, or
audience-specific workflow would otherwise be unexplained.
