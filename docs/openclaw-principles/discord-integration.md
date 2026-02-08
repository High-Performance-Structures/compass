Discord Integration
===

how OpenClaw connects to Discord, processes inbound messages, delivers replies, and exposes guild operations to the agent. covers the monitoring pipeline, the outbound delivery system, thread and DM handling, slash commands, and the action gating model. relevant context for Compass because Discord is one of OpenClaw's most complete channel integrations — around 70 files and 10k lines — and its architecture illustrates patterns that any new channel (or any Compass integration with OpenClaw's messaging layer) would need to follow.


why channels are structured this way
---

OpenClaw supports many messaging surfaces — Discord, Telegram, WhatsApp, Slack, Signal, a web UI, and several extension channels. each has wildly different capabilities and constraints: Discord has slash commands, threads, reactions, and embeds; WhatsApp has none of these but supports end-to-end encryption; Telegram sits somewhere in between. the challenge is giving the agent access to channel-specific features while keeping the core agent loop channel-agnostic.

the solution is a three-layer architecture. the **monitor layer** receives events from Discord and normalizes them into a common inbound format. the **outbound layer** takes the agent's response and formats it for Discord's specific constraints (character limits, chunking, embeds). the **channel plugin layer** provides shared abstractions (send text, send media, send poll) that the agent's tool system calls without knowing which channel it's talking to.

this separation matters because it means the agent doesn't need Discord-specific knowledge. it calls `message(action="send", to="user:123", message="hello")` and the routing layer figures out that this is a Discord DM, resolves the right bot account, and calls the Discord API. the agent's system prompt mentions available channels but doesn't contain Discord API details.


the monitoring pipeline
---

the entry point is `monitorDiscordProvider()` in `src/discord/monitor/provider.ts`. initialization follows a specific sequence because order matters — you can't register event listeners before the client is ready, and you can't deploy slash commands before you've validated the application ID.

```
monitorDiscordProvider()
  → resolveDiscordAccount() — load per-account config
  → fetchDiscordApplicationId() — validate bot setup
  → new Client() — create Carbon discord.js wrapper
  → registerDiscordListener() — attach event handlers
  → deployDiscordCommands() — register native slash commands
```

the client is created with gateway intents that control which events Discord sends. the base set is always: Guilds, GuildMessages, MessageContent, DirectMessages, GuildMessageReactions, DirectMessageReactions. two additional intents — GuildPresences and GuildMembers — require explicit opt-in because Discord gates these behind a privileged intent approval for bots in more than 100 guilds. this is a Discord-imposed constraint, not an OpenClaw choice.


inbound message flow
---

a Discord message passes through four stages before reaching the agent.

**stage 1: event listener.** `DiscordMessageListener` in `src/discord/monitor/listeners.ts` wraps Carbon's `MessageCreateListener`. when a message arrives, it gets queued with slow-listener detection — if the handler takes too long, the system flags it rather than blocking other events.

**stage 2: debouncing.** the message handler in `src/discord/monitor/message-handler.ts` batches rapid-fire messages from the same user in the same channel. the debounce key is `discord:{accountId}:{channelId}:{authorId}`. this exists because Discord users commonly split a thought across multiple quick messages. without debouncing, the agent would receive three separate prompts and try to respond to each one independently, producing three partial replies instead of one coherent response. when multiple messages arrive in the debounce window, their text gets concatenated and the last message's metadata (attachments, reference info) is preserved.

**stage 3: preflight.** `message-handler.preflight.ts` validates whether the message should be processed at all. this is where most messages get dropped — bot messages (to prevent loops), messages from ungated guilds, messages in disallowed channels, DMs when DM policy is disabled. the preflight also resolves PluralKit proxy identity (if enabled), checks mention requirements, and extracts thread context. the output is either a `DiscordMessagePreflightContext` or null.

the PluralKit integration deserves a mention: PluralKit is a Discord bot used by plural systems to proxy messages under different identities. OpenClaw can optionally resolve the actual proxied author, which means the agent sees the correct identity rather than the PluralKit bot. this is configured per-account and requires the PluralKit system ID.

**stage 4: dispatch.** `message-handler.process.ts` sends the validated message to the agent via `dispatchInboundMessage()`. it starts a typing indicator (so the user sees "OpenClaw is typing..."), manages ack reactions (a configurable emoji the bot adds to acknowledge receipt, removed after the reply arrives), and routes the agent's response back through the outbound pipeline.


outbound delivery
---

the outbound pipeline in `src/discord/send.outbound.ts` and `reply-delivery.ts` handles the translation from "agent wants to say X" to "Discord receives properly formatted messages."

discord imposes a 2000-character limit per message. the pipeline chunks responses by both character count and line count (default 17 lines per message). the line limit exists because a single 2000-character message is a wall of text on mobile — breaking it into shorter messages improves readability even when the character limit isn't reached.

the first chunk gets a reply-to reference (so it threads under the user's message in Discord's UI). subsequent chunks are sent as follow-up messages without the reference. media attachments go with the first message when possible; additional media gets separate messages.

markdown formatting gets adjusted for Discord's flavor. tables, which Discord doesn't render natively, get converted to a format that displays reasonably in a monospace code block. this is a lossy transformation but better than sending raw pipe-delimited tables that render as garbled text.


slash commands
---

native slash commands are built in `src/discord/monitor/native-command.ts`. OpenClaw maps its internal command registry to Discord's `ApplicationCommand` format, which means commands registered in OpenClaw automatically appear as slash commands in the Discord UI with proper argument types, descriptions, and autocomplete.

the implementation handles a subtle Discord constraint: interactions expire after 3 seconds. if the agent takes longer than that to respond (which it almost always does), the interaction becomes invalid. the system wraps all interaction replies in `safeDiscordInteractionCall()`, which catches Discord error 10062 (Unknown interaction) and degrades gracefully — typically by sending a follow-up message to the channel instead of replying to the interaction.

for commands with many options, the system renders button menus instead of requiring the user to type a value. each button encodes its context in the custom ID string: `cmdarg:command=X;arg=Y;value=Z;user=U`. this is stateless — no server-side session is needed to handle the button click, because all the necessary context is embedded in the button itself. the tradeoff is that custom IDs have a 100-character limit, which constrains how much context can be embedded.


threads and DMs
---

**threads** are detected by channel type (PublicThread, PrivateThread, AnnouncementThread). OpenClaw supports two thread modes: responding in existing threads (always), and auto-creating threads for new conversations (`channelConfig.autoThread=true`). auto-thread creation takes the first message's text as the thread name (sanitized, with a fallback to "Thread {messageId}").

thread starters are cached because Discord's API doesn't include the original message when delivering events in a thread. the cache maps message ID to text/author/timestamp, which lets the agent see the context that started the conversation.

threads inherit their parent channel's permissions and bindings, but the session key includes the thread ID — so each thread gets its own conversation state. this means the agent maintains separate context per thread, which is the correct behavior for a guild where multiple threads discuss different topics simultaneously.

**DMs** are governed by a three-tier policy:

- `"open"`: accept all DMs. simplest setup, appropriate for personal bots.
- `"pairing"`: require an authentication code before accepting. the bot sends a code, the user provides it through another channel, and DMs are unlocked. this prevents random users from consuming agent resources.
- `"disabled"`: reject all DMs.

group DMs are opt-in separately (`dm.groupEnabled`) because they have different trust characteristics — a group DM includes multiple users, so the agent's responses are visible to people who may not have been explicitly authorized.


multi-account support
---

OpenClaw can run multiple Discord bots simultaneously via `discord.accounts.{id}`. each account has its own token, configuration, event listeners, and gateway connection. a gateway registry (`src/discord/monitor/gateway-registry.ts`) maps account IDs to gateway plugins so agent tools resolve the correct bot when performing operations.

the default account ID is `"default"`, used when no specific account is referenced. this means single-bot deployments don't need to think about accounts at all — the configuration is backward-compatible.

multi-account is useful for deployments where different guilds need different bot identities (different names, avatars, permission sets) while sharing the same underlying agent.


routing
---

when a Discord message passes preflight, it gets routed to an agent via `resolveAgentRoute()`. the routing key includes:

- `channel: "discord"`
- `accountId`
- `peer: { kind: "dm"|"group"|"channel", id }` — who sent it
- `parentPeer` — for threads, the parent channel
- `guildId` — guild context

routing returns an agent ID, session key, and binding info. the binding system allows per-guild and per-channel routing — guild A can route to agent "support" while guild B routes to agent "main". channel-level bindings override guild-level, which overrides the account default.

this cascading resolution is important for multi-guild deployments where different communities need different agent behavior.


allowlists and gating
---

access control happens through allowlists that support multiple ID formats:

- bare numeric IDs
- `user:` prefixed
- `discord:` prefixed
- `pk:` (PluralKit system IDs)
- slug-based lookups (normalized channel/guild names)

the resolution cascades: per-channel config overrides per-guild, which overrides account defaults. this means you can have a guild-wide allowlist with specific channels that have tighter or looser restrictions.


agent actions
---

the Discord channel exposes over 30 actions to the agent through the tool system. these are defined in `src/agents/tools/discord-actions*.ts` and gated by `DiscordActionConfig`, a per-account configuration that controls which categories of actions are available.

the categories:

- **messaging**: send, read, edit, delete, pin messages
- **reactions**: add, remove, read reactions
- **threads**: create, list, reply in threads
- **guild info**: member lookup, role info, channel info
- **moderation**: timeout, kick, ban members
- **channel management**: create, edit, delete, move channels, manage permissions
- **rich content**: polls, embeds, file attachments, emoji and sticker uploads
- **presence**: set bot status and activity
- **search**: message search with query filters

the gating is coarse-grained by category. you can disable all moderation actions for an account while keeping messaging enabled. this is a practical choice — fine-grained per-action gating would create a configuration surface too large to manage, while category-level gating covers the real use cases (a community bot that shouldn't moderate, a personal bot that should have full access).

the action gating is independent of Discord's own permission system. even if an action is enabled in OpenClaw's config, it will fail if the bot's Discord role doesn't have the necessary permissions. Discord error 50013 (Missing Permissions) is caught and logged without crashing the handler.


error handling
---

the integration is designed to survive Discord's various failure modes without taking down the gateway.

**retry with backoff**: `createDiscordRetryRunner()` wraps API calls with exponential backoff. configured per-account. this handles transient Discord API errors (rate limits, 5xx responses) without manual intervention.

**interaction expiry**: the 3-second interaction timeout is handled gracefully. rather than crashing when the agent takes longer to respond, the system catches the expiry and falls back to a regular channel message.

**permission errors**: Discord 50013 (missing permissions) and 50007 (can't DM user) are caught, logged, and don't propagate. the agent receives an error result from the tool call, which lets it explain the failure to the user rather than silently failing.

**slow-listener detection**: event listeners that take too long get flagged. this prevents a single slow handler from blocking the event queue and causing the bot to appear unresponsive.

**debounce resilience**: the inbound debouncer preserves the last message's metadata across batches. if something goes wrong mid-batch, the system still has enough context to process at least the final message.


relevance to compass
---

the Discord integration illustrates patterns that would apply to any Compass integration with OpenClaw's messaging layer:

**the three-layer architecture** (monitor, outbound, channel plugin) is how all channels work. if Compass adds its own messaging surface (in-app notifications, a chat panel, a Slack integration), it would follow the same pattern — a monitor that receives events, an outbound layer that formats responses, and a channel plugin that provides the shared abstractions.

**the allowlist and routing model** shows how multi-tenant deployments work. if Compass serves multiple organizations, each would need its own routing bindings and access control, similar to how Discord guilds are isolated.

**the action gating model** demonstrates how to give the agent channel-specific capabilities without hardcoding them. Compass could expose project-specific actions (create task, update schedule, assign member) through the same tool system, gated by user role or project permissions.

**the debouncing pattern** is worth adopting for any real-time messaging interface. users don't compose complete thoughts in single messages, and an agent that responds to each fragment independently produces a poor experience.
