System Prompt Architecture
===

how OpenClaw constructs the system prompt that shapes agent behavior. covers the prompt builder in `src/agents/system-prompt.ts`, the design decisions behind its structure, and why it works the way it does. relevant context for Compass if we build agent features that need to understand or extend how the AI's instructions are assembled.


why a prompt builder, not a prompt template
---

the obvious approach to system prompts is a template — a big string with some variables interpolated in. OpenClaw doesn't do this. instead, `buildAgentSystemPrompt()` assembles the prompt from a set of independent section builders, each returning a `string[]` that gets concatenated at the end.

the reason is that the prompt needs to change shape dramatically based on context. a main agent talking through Telegram with inline buttons enabled, a memory store, and a SOUL.md personality file needs a fundamentally different prompt than a subagent spawned to do a background file search. a template approach would drown in conditionals. the section-builder approach means each concern is isolated — the messaging section doesn't know or care about the memory section, and either can be omitted entirely without touching the other.

this matters for Compass because if we integrate with OpenClaw's agent layer, the prompt that runs behind our AI chat panel will be shaped by these same mechanics. understanding what's included (and what's excluded) in different modes determines what the agent can and can't do.


prompt modes
---

the builder supports three modes, controlled by a `PromptMode` parameter:

**"full"** is the default. every section gets included — tooling, safety, skills, memory, messaging, voice, reactions, heartbeats, silent reply protocol, runtime metadata. this is what the main agent gets when a user talks to it through a channel.

**"minimal"** strips the prompt down for subagents. skills, memory, docs, messaging, voice, reactions, heartbeats, and silent replies all get dropped. what remains is tooling, workspace, and runtime info — enough for the subagent to do its job, not enough to make it think it's the primary conversational agent.

**"none"** returns a single line: `"You are a personal assistant running inside OpenClaw."` this exists for cases where almost all behavior comes from injected context rather than hardcoded instructions.

the distinction between full and minimal is worth understanding. a subagent that inherits the full prompt would try to manage heartbeats, react to messages with emojis, and follow the silent reply protocol — behaviors that make no sense for a background worker. the mode system prevents this without requiring the caller to manually strip sections.


the sections
---

each section is built by a dedicated function that returns an array of strings (empty array means "don't include this section"). the main builder concatenates everything and filters out empty strings.

**tooling** is the most complex section. it takes a list of tool names, deduplicates them (case-insensitive but preserving original casing), and renders them in a fixed order with human-readable summaries. core tools like `read`, `exec`, and `browser` have hardcoded summaries. external tools can provide their own summaries through a separate map. tools not in the predefined order get sorted alphabetically at the end. the ordering matters because models tend to weight items higher when they appear earlier in their context.

**safety** is a short set of guardrails — no self-preservation, no manipulation, comply with stop requests, don't bypass safeguards. this section is always included in full and minimal modes.

**skills** teaches the agent how to discover and use skill files. it instructs the agent to scan available skill descriptions, pick the most specific match, and read exactly one SKILL.md file before proceeding. the constraint against reading multiple skills upfront is deliberate — it keeps the context window lean and forces the agent to commit to an approach rather than hedging.

**memory** instructs the agent to search memory files before answering questions about prior work, preferences, or decisions. it supports a citations mode that controls whether the agent includes source paths in its replies.

**messaging** handles multi-channel routing. it tells the agent how to reply in the current session versus sending cross-session messages, explains the `message` tool for proactive sends, and includes inline button guidance when the channel supports it. this section only appears when the `message` tool is available.

**context files** are user-editable files (like SOUL.md) that get injected verbatim into the prompt under a "Project Context" header. if a SOUL.md is present, the builder adds an extra instruction to embody its persona. this is how personality customization works — the prompt builder provides the mechanism, the user provides the content.

the remaining sections — user identity, time, voice, docs, reply tags, reactions, reasoning format, silent replies, heartbeats, and runtime — each handle a specific concern. most are a few lines. none depend on each other.


tool name resolution
---

one subtle design decision: tool names are case-sensitive in the final output but deduplicated case-insensitively. if the caller provides both `Read` and `read`, only the first one survives. but the output preserves whichever casing the caller used. this matters because some model providers are strict about tool name casing in their API, and the prompt needs to match exactly what the tool registry will accept.

the resolution works through a `Map<string, string>` that maps normalized (lowercase) names to their first-seen canonical form. when rendering the tool list or referencing a tool in prose (like "use `read` to read files"), the builder calls `resolveToolName()` to get the caller's preferred casing.


the runtime line
---

the prompt ends with a single-line runtime summary:

```
Runtime: agent=main | host=server | os=linux (x86_64) | model=claude-sonnet-4-5-20250929 | channel=telegram | capabilities=inlineButtons | thinking=off
```

this is exposed as a separate export (`buildRuntimeLine()`) because other parts of the system use it independently — for example, status commands that need to show the agent's current configuration.

the runtime line is where the agent learns what model it's running on, what channel it's connected to, and what capabilities are available. it's a compressed format because it appears at the end of every prompt and the information density matters more than readability.


the silent reply protocol
---

one of the more interesting design choices. the agent needs a way to say "i have nothing to add" without actually saying that to the user. the prompt defines a `SILENT_REPLY_TOKEN` — a special string that, when returned as the agent's entire response, gets intercepted and discarded before reaching the user.

the prompt is explicit and repetitive about the rules for this token because models tend to violate them. the token must be the *entire* message. it can't be appended to a real reply. it can't be wrapped in markdown. the prompt includes both correct and incorrect examples. this is a case where the repetition is load-bearing — without it, the model will occasionally leak the token into visible output.


design tradeoffs
---

the builder is around 680 lines, which is large for a single file. the alternative would be splitting each section into its own module. the reason it stays consolidated is that the sections share a lot of derived state — the `availableTools` set, the `isMinimal` flag, resolved tool names, runtime capabilities. splitting would mean either passing a large context object between modules or computing the same derived values in multiple places. the current approach keeps all the prompt logic in one place where the interactions between sections are visible.

the string-array-concatenation approach (as opposed to, say, a template literal or a structured prompt object) was chosen for composability. each section builder can return zero or more lines without knowing what comes before or after it. the top-level builder just concatenates and filters. this makes it straightforward to add, remove, or reorder sections without cascading changes.

one limitation: the prompt has no explicit token budget. sections are included or excluded based on mode and feature flags, but there's no mechanism to truncate or summarize if the total prompt exceeds a model's context window. in practice, the full prompt (without context files) stays well under the limit. context files are the wildcard — a large SOUL.md or many embedded files could push it over. this hasn't been a problem yet, but it's a gap worth noting.


relevance to compass
---

if Compass uses OpenClaw's agent layer for its AI chat panel, the system prompt is the primary control surface for agent behavior. understanding the builder means understanding what knobs are available:

- **prompt mode** controls how much autonomy the agent has. a chat panel agent probably wants something between minimal and full — tool access and context awareness, but not heartbeat management or reaction guidance.
- **context files** are how Compass-specific knowledge would be injected. project data, user preferences, or domain-specific instructions would flow through this mechanism.
- **tool availability** determines what the agent can do. the tool list in the prompt must match what's actually registered in the runtime, and the prompt's tool summaries influence how the model chooses between them.
- **the messaging section** would need adaptation if Compass routes messages differently than OpenClaw's built-in channels.

the builder is designed to be extended. adding a new section means writing a function that returns `string[]` and splicing it into the main assembly. the pattern is consistent enough that this is a low-risk change.
