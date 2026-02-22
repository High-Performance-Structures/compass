Provider Auth and Model Unification Plan
===

Status: draft for implementation
Date: 2026-02-18
Priority: P0 (release-blocking)


context
---

We need one reliable auth and model-selection system that supports:

1. Anthropic OAuth (Claude Pro/Max) in browser and desktop.
2. API-key auth (Anthropic, OpenRouter, Ollama, custom).
3. Provider-scoped model lists in both Settings and chat input.

Anthropic OAuth working on both desktop and browser is a non-negotiable requirement.


non-negotiable outcomes
---

1. A user can authenticate with exactly one active provider method at a time and switch safely.
2. Anthropic OAuth works in browser and desktop paths, including token refresh.
3. Settings model picker only shows models available to the current provider/account.
4. Chat model picker shows the same provider-scoped models and uses the selected model at runtime.
5. Web (`src/app/api/agent/route.ts`) and standalone (`packages/agent-server/src/stream.ts`) behavior is functionally identical.


current state diagnosis
---

The current implementation has multiple sources of truth and split runtime behavior.

- Provider and model state is split across local storage (`src/components/agent/model-dropdown.tsx`), DB config (`src/app/actions/provider-config.ts`), and global model config (`src/app/actions/ai-config.ts`).
- Browser route resolves OAuth access tokens, but standalone route expects provider api keys in JWT payload and does not resolve OAuth tokens the same way.
- Chat model selector is hardcoded to preset Anthropic-style options and is not provider-scoped.
- Settings model list is fetched from OpenRouter with env key, not user-selected provider credentials.
- Model override mapping is slot-based (`sonnet/opus/haiku`) and does not reliably map to effective runtime model IDs.
- Provider save flow can unintentionally clear existing API keys when users save without re-entering the key.


target architecture
---

single source of truth

- Server-side user provider config is the canonical source for:
  - active provider type
  - provider credentials reference
  - provider base URL (if applicable)
  - selected model ID for that provider
- Local storage is treated as UI cache only, never authoritative.

shared runtime resolver

- One shared resolver determines effective runtime auth + model for both web and standalone agent execution.
- Resolver responsibilities:
  - load active provider configuration
  - resolve/refresh OAuth access token when provider is Anthropic OAuth
  - apply provider-specific model ID normalization
  - return effective provider + effective model

provider-scoped catalog service

- One model catalog service returns models for the active provider/account.
- Settings and chat model selectors consume the same catalog output shape.


scope
---

in scope

- Anthropic OAuth parity and reliability for browser and desktop.
- Provider-specific model discovery and selection.
- Runtime convergence for web and standalone agent paths.
- Data integrity fixes for provider credential persistence.
- Test coverage for auth/model regression prevention.

out of scope

- New provider integrations beyond current set.
- Billing UX redesign.
- Large visual redesign of settings/chat UI.


delivery plan
---

phase 0: guardrails and observability

Goal: reduce ambiguity while implementing fixes.

- Add structured logging around provider resolution and model resolution in both runtime paths.
- Add explicit error categories for auth failure vs token refresh failure vs provider model mismatch.
- Freeze unrelated provider/auth feature work until this plan lands.

Exit criteria:
- Team can trace every request from selected provider/model to effective runtime provider/model.


phase 1: data integrity and credential safety

Goal: stop accidental credential loss and stabilize provider switching.

- Update provider save semantics so existing API key remains unchanged unless user explicitly replaces or clears it.
- Add explicit "clear credential" behavior per provider.
- Ensure provider switch does not silently wipe unrelated fields unless intended.
- Document the exact provider-state transitions (switch, save, reset).

Exit criteria:
- Saving provider settings without entering a new key does not remove stored key.
- Provider switch/reset behavior is deterministic and tested.


phase 2: anthropic oauth parity (browser + desktop)

Goal: Anthropic OAuth is reliable in both runtime paths.

- Consolidate OAuth token lifecycle (exchange, refresh, expiry checks) behind one shared service contract.
- Ensure browser flow and desktop flow both produce/consume the same token storage semantics.
- Ensure standalone agent execution resolves Anthropic OAuth access token at request time (same behavior as web route).
- Normalize OAuth-specific transport behavior required by Anthropic runtime.
- Add explicit UX errors for:
  - missing OAuth session
  - refresh token invalid/expired
  - provider-side OAuth rejection

Exit criteria:
- Anthropic OAuth works end-to-end in browser and desktop.
- Token refresh is automatic and verified in both paths.


phase 3: provider-scoped model catalogs

Goal: model lists reflect the currently authenticated provider/account.

- Implement provider-aware model catalog contract with normalized model metadata.
- OpenRouter catalog uses user-provided OpenRouter credential context.
- Anthropic catalog uses Anthropic credential context (OAuth or API key).
- Ollama/custom use provider-specific discovery where possible, with manual fallback path.
- Add caching with short TTL and clear invalidation strategy on provider change.

Exit criteria:
- Settings receives model lists from active provider only.
- Catalog errors are provider-specific and actionable.


phase 4: unify model selection ux and runtime usage

Goal: one model selection experience across settings and chat.

- Replace hardcoded chat model dropdown behavior with provider-scoped options from shared catalog.
- Persist selected model in server-side provider config.
- Keep local storage only as a view cache/hydration optimization.
- Ensure model selected in chat is the model used by the next inference call.
- Ensure settings and chat stay in sync after provider/model changes.

Exit criteria:
- Settings and chat show the same selected model and same eligible model list.
- Runtime consistently uses selected model.


phase 5: remove conflicting legacy paths and tighten docs

Goal: remove tech debt that caused regressions.

- Retire legacy slot-based override assumptions where they conflict with explicit selected-model behavior.
- Remove duplicate model-mapping logic once shared resolver is in place.
- Update docs to reflect final architecture and operational flows.

Exit criteria:
- No duplicate provider/model resolution logic remains in active paths.
- Architecture docs match runtime behavior.


test strategy
---

integration matrix (must pass)

1. Browser + Anthropic OAuth + model select + chat inference.
2. Desktop + Anthropic OAuth + model select + chat inference.
3. Browser + Anthropic API key + model select + chat inference.
4. Browser + OpenRouter key + provider model list + chat inference.
5. Provider switch across Anthropic OAuth -> OpenRouter -> Anthropic key without credential loss.
6. Token refresh path under expiring OAuth token in both web and standalone runtime paths.

regression checks

- Save provider without entering new key keeps existing key.
- Model list updates immediately on provider change.
- Chat request headers and runtime resolver agree on effective model.
- Error messages differentiate auth, token, and provider/model failures.


risks and mitigations
---

Risk: Anthropic OAuth endpoint/client validation is stricter than expected.
Mitigation: keep OAuth exchange path spec-aligned, add instrumentation, and include explicit fallback messaging while preserving OAuth as required target.

Risk: Desktop and browser drift again after fixes.
Mitigation: shared resolver contract used by both paths, plus parity tests in CI.

Risk: Provider catalog APIs vary in shape/availability.
Mitigation: normalized catalog interface + per-provider adapters + graceful manual fallback.

Risk: Existing users have mixed legacy local-storage/provider states.
Mitigation: one-time migration and reconciliation logic with safe defaults and clear reset behavior.


rollout plan
---

1. Land phases 0-2 behind internal feature flags.
2. Validate Anthropic OAuth parity in staging on browser and desktop.
3. Land phases 3-4 and run full matrix.
4. Remove legacy paths in phase 5.
5. Enable by default after one full release cycle of monitoring.


definition of done
---

All of the following must be true:

- Anthropic OAuth works in browser and desktop, including refresh.
- Users can use Anthropic key, OpenRouter key, Ollama/custom key/base URL, or Anthropic OAuth.
- Model lists are provider-scoped in Settings and chat.
- Selected model is consistently used at runtime in both web and standalone paths.
- Credential persistence is safe and explicit.
- Test matrix passes and docs are updated.


proposed pr sequence
---

1. PR1: observability + provider save safety.
2. PR2: shared provider/model resolver foundation.
3. PR3: Anthropic OAuth parity for standalone runtime.
4. PR4: provider-scoped model catalog service.
5. PR5: settings/chat selector unification on shared catalog.
6. PR6: legacy path cleanup + docs finalization.
