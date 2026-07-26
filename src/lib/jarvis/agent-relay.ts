import { eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { jarvisBridgeEvents } from "@/db/schema-jarvis"

type CompassDb = ReturnType<typeof getDb>

const MAX_RELAY_MESSAGES = 20
const MAX_MESSAGE_CHARACTERS = 4_000
const MAX_TOTAL_MESSAGE_CHARACTERS = 32_000
const DEFAULT_TIMEOUT_MILLISECONDS = 90_000
const DEFAULT_POLL_MILLISECONDS = 750

export type AgentRelayMessage = {
  readonly role: "user" | "assistant"
  readonly content: string
}

type RelayRequestInput = {
  readonly db: CompassDb
  readonly organizationId: string | null
  readonly user: {
    readonly id: string
    readonly displayName: string | null
    readonly email: string
    readonly role: string
  }
  readonly sessionId: string
  readonly currentPage: string
  readonly timezone: string
  readonly messages: ReadonlyArray<AgentRelayMessage>
  readonly timeoutMilliseconds?: number
  readonly pollMilliseconds?: number
}

export type AgentRelayResult =
  | {
      readonly success: true
      readonly content: string
    }
  | {
      readonly success: false
      readonly error: string
      readonly timedOut: boolean
    }

type RelayEventState = {
  readonly id: string
  readonly status: string
  readonly result: string | null
  readonly lastError: string | null
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function normalizedSessionId(sessionId: string): string {
  const trimmed = sessionId.trim()
  if (trimmed.length === 0 || trimmed.length > 128) {
    return crypto.randomUUID()
  }
  return trimmed
}

export function relayMessages(
  messages: ReadonlyArray<AgentRelayMessage>,
): ReadonlyArray<AgentRelayMessage> {
  const candidates = messages.slice(-MAX_RELAY_MESSAGES)
  const selected: AgentRelayMessage[] = []
  let remainingCharacters = MAX_TOTAL_MESSAGE_CHARACTERS

  for (
    let index = candidates.length - 1;
    index >= 0 && remainingCharacters > 0;
    index -= 1
  ) {
    const message = candidates[index]
    if (!message) continue
    const content = message.content.slice(
      0,
      Math.min(MAX_MESSAGE_CHARACTERS, remainingCharacters),
    )
    selected.unshift({ role: message.role, content })
    remainingCharacters -= content.length
  }

  return selected
}

async function requestDigest(
  userId: string,
  sessionId: string,
  messages: ReadonlyArray<AgentRelayMessage>,
): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify({ userId, sessionId, messages }),
  )
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export function parseAgentRelayResult(
  serializedResult: string | null,
): string | null {
  if (!serializedResult) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(serializedResult)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null

  const content = Reflect.get(parsed, "content")
  return typeof content === "string" && content.trim().length > 0
    ? content
    : null
}

export function isJarvisAgentBridgeEnabled(
  value: string | undefined,
): boolean {
  if (!value) return false
  return ["1", "true", "yes", "on"].includes(
    value.trim().toLowerCase(),
  )
}

async function readEventState(
  db: CompassDb,
  idempotencyKey: string,
): Promise<RelayEventState | null> {
  return (
    (await db
      .select({
        id: jarvisBridgeEvents.id,
        status: jarvisBridgeEvents.status,
        result: jarvisBridgeEvents.result,
        lastError: jarvisBridgeEvents.lastError,
      })
      .from(jarvisBridgeEvents)
      .where(eq(jarvisBridgeEvents.idempotencyKey, idempotencyKey))
      .get()) ?? null
  )
}

export async function relayAgentRequest(
  input: RelayRequestInput,
): Promise<AgentRelayResult> {
  const sessionId = normalizedSessionId(input.sessionId)
  const messages = relayMessages(input.messages)
  const digest = await requestDigest(input.user.id, sessionId, messages)
  const idempotencyKey = `agent:${input.user.id}:${digest}`
  const now = new Date().toISOString()

  await input.db
    .insert(jarvisBridgeEvents)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      direction: "outbound",
      source: "ask-jarvis",
      eventType: "agent.prompt",
      idempotencyKey,
      payload: JSON.stringify({
        schemaVersion: 1,
        sessionId,
        user: input.user,
        context: {
          organizationId: input.organizationId,
          currentPage: input.currentPage,
          timezone: input.timezone,
        },
        messages,
        safety: {
          basicAssistanceOnly: true,
          toolsAllowed: false,
        },
        createdAt: now,
      }),
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  const timeoutMilliseconds =
    input.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS
  const pollMilliseconds =
    input.pollMilliseconds ?? DEFAULT_POLL_MILLISECONDS
  const deadline = Date.now() + timeoutMilliseconds

  while (Date.now() < deadline) {
    const event = await readEventState(input.db, idempotencyKey)
    if (!event) {
      return {
        success: false,
        error: "Jarvis relay event could not be created",
        timedOut: false,
      }
    }

    if (event.status === "completed") {
      const content = parseAgentRelayResult(event.result)
      if (!content) {
        return {
          success: false,
          error: "Jarvis returned an empty response",
          timedOut: false,
        }
      }
      return { success: true, content }
    }

    if (event.status === "failed") {
      return {
        success: false,
        error: event.lastError ?? "Jarvis could not answer this request",
        timedOut: false,
      }
    }

    await sleep(pollMilliseconds)
  }

  return {
    success: false,
    error:
      "Jarvis is taking longer than expected. Please try again in a moment.",
    timedOut: true,
  }
}

export function createAgentRelayResponse(content: string): Response {
  const events = [
    {
      type: "text",
      content,
    },
    {
      type: "result",
      subtype: "success",
      result: content,
    },
  ]
  const body = `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
