/**
 * In-memory session store for SDK session state
 */

export interface SessionState {
  sessionId: string
  createdAt: Date
  lastAccessedAt: Date
  metadata?: Record<string, unknown>
}

const sessions = new Map<string, SessionState>()

export function getOrCreateSession(sessionId: string): SessionState {
  let session = sessions.get(sessionId)

  if (!session) {
    session = {
      sessionId,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }
    sessions.set(sessionId, session)
  } else {
    session.lastAccessedAt = new Date()
  }

  return session
}

export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId)
}

export function getAllSessions(): SessionState[] {
  return Array.from(sessions.values())
}

// Cleanup sessions older than 1 hour
export function cleanupStaleSessions(maxAgeMs: number = 3600000): number {
  const now = Date.now()
  let deleted = 0

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastAccessedAt.getTime() > maxAgeMs) {
      sessions.delete(sessionId)
      deleted++
    }
  }

  return deleted
}

// Run cleanup every 10 minutes
setInterval(() => {
  const deleted = cleanupStaleSessions()
  if (deleted > 0) {
    console.log(`Cleaned up ${deleted} stale sessions`)
  }
}, 600000)
