// conversation session management -- in-memory message history

interface Message {
  readonly role: "user" | "assistant"
  readonly content: string
}

interface Session {
  id: string
  messages: Message[]
  createdAt: number
}

const MAX_MESSAGES = 100
const MAX_SESSIONS = 50
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

const sessions = new Map<string, Session>()

function cleanupSessions(): void {
  const now = Date.now()

  // remove expired sessions
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id)
    }
  }

  // if still over limit, remove oldest
  if (sessions.size > MAX_SESSIONS) {
    let oldestId: string | null = null
    let oldestTime = Infinity
    for (const [id, session] of sessions) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt
        oldestId = id
      }
    }
    if (oldestId) sessions.delete(oldestId)
  }
}

export function getOrCreateSession(
  conversationId: string,
): Session {
  const existing = sessions.get(conversationId)
  if (existing) return existing

  cleanupSessions()

  const session: Session = {
    id: conversationId,
    messages: [],
    createdAt: Date.now(),
  }
  sessions.set(conversationId, session)
  return session
}

export function addMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): void {
  const session = getOrCreateSession(conversationId)
  session.messages.push({ role, content })

  // trim to keep last MAX_MESSAGES
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(
      -MAX_MESSAGES,
    )
  }
}

export function getMessages(
  conversationId: string,
): ReadonlyArray<Message> {
  const session = sessions.get(conversationId)
  if (!session) return []
  return session.messages
}

export function clearSession(
  conversationId: string,
): void {
  sessions.delete(conversationId)
}
