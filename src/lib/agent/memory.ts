import { eq, and, like, or, sql } from "drizzle-orm"
import { slabMemories } from "@/db/schema"
import type { DrizzleD1Database } from "drizzle-orm/d1"

type Db = DrizzleD1Database<Record<string, unknown>>

const PRUNE_THRESHOLD = 150
const STALE_DAYS = 90
const MIN_SCORE = 0.2
const DECAY_RATE = 0.95

function effectiveScore(
  importance: number,
  pinned: boolean,
  createdAt: string,
): number {
  if (pinned) return 1.0
  const age = Date.now() - new Date(createdAt).getTime()
  const days = age / (1000 * 60 * 60 * 24)
  return importance * Math.pow(DECAY_RATE, days)
}

function normalizeTags(raw?: string): string | null {
  if (!raw) return null
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .join(",")
}

function wordOverlap(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/))
  const setB = new Set(b.toLowerCase().split(/\s+/))
  let overlap = 0
  for (const w of setA) {
    if (setB.has(w)) overlap++
  }
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : overlap / union
}

export async function loadMemoriesForPrompt(
  db: Db,
  userId: string,
  budget = 1500,
): Promise<string> {
  const rows = await db
    .select()
    .from(slabMemories)
    .where(eq(slabMemories.userId, userId))

  if (rows.length === 0) return ""

  if (rows.length > PRUNE_THRESHOLD) {
    await pruneStaleMemories(db, userId)
  }

  const scored = rows
    .map((r) => ({
      ...r,
      score: effectiveScore(r.importance, r.pinned, r.createdAt),
    }))
    .filter((r) => r.score > MIN_SCORE)
    .sort((a, b) => b.score - a.score)

  const lines: string[] = []
  let used = 0
  const accessed: string[] = []

  for (const m of scored) {
    const line = `- [${m.memoryType}] ${m.content}`
    if (used + line.length > budget) break
    lines.push(line)
    used += line.length
    accessed.push(m.id)
  }

  if (accessed.length > 0) {
    const now = new Date().toISOString()
    await db
      .update(slabMemories)
      .set({
        accessCount: sql`${slabMemories.accessCount} + 1`,
        lastAccessedAt: now,
      })
      .where(
        and(
          eq(slabMemories.userId, userId),
          sql`${slabMemories.id} IN (${sql.join(
            accessed.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      )
  }

  return lines.join("\n")
}

export async function saveMemory(
  db: Db,
  userId: string,
  content: string,
  memoryType: string,
  tags?: string,
  importance?: number,
): Promise<string> {
  const keywords = content.toLowerCase().split(/\s+/)
  const longest = keywords.reduce(
    (a, b) => (b.length > a.length ? b : a),
    "",
  )

  const candidates = await db
    .select()
    .from(slabMemories)
    .where(
      and(
        eq(slabMemories.userId, userId),
        like(slabMemories.content, `%${longest}%`),
      ),
    )

  for (const c of candidates) {
    if (wordOverlap(c.content, content) > 0.6) {
      await db
        .update(slabMemories)
        .set({
          content,
          memoryType,
          tags: normalizeTags(tags),
          importance: importance ?? 0.7,
        })
        .where(eq(slabMemories.id, c.id))
      return c.id
    }
  }

  const id = crypto.randomUUID()
  await db.insert(slabMemories).values({
    id,
    userId,
    content,
    memoryType,
    tags: normalizeTags(tags),
    importance: importance ?? 0.7,
    pinned: false,
    accessCount: 0,
    lastAccessedAt: null,
    createdAt: new Date().toISOString(),
  })

  return id
}

export async function searchMemories(
  db: Db,
  userId: string,
  query: string,
  limit = 5,
): Promise<ReadonlyArray<{
  id: string
  content: string
  memoryType: string
  tags: string | null
  score: number
}>> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)

  if (terms.length === 0) return []

  const conditions = terms.map((t) =>
    or(
      like(slabMemories.content, `%${t}%`),
      like(slabMemories.tags, `%${t}%`),
    ),
  )

  const rows = await db
    .select()
    .from(slabMemories)
    .where(
      and(
        eq(slabMemories.userId, userId),
        or(...conditions),
      ),
    )

  return rows
    .map((r) => ({
      id: r.id,
      content: r.content,
      memoryType: r.memoryType,
      tags: r.tags,
      score: effectiveScore(r.importance, r.pinned, r.createdAt),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export async function pruneStaleMemories(
  db: Db,
  userId: string,
): Promise<number> {
  const cutoff = new Date(
    Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const result = await db
    .delete(slabMemories)
    .where(
      and(
        eq(slabMemories.userId, userId),
        eq(slabMemories.pinned, false),
        sql`${slabMemories.importance} < 0.3`,
        sql`${slabMemories.createdAt} < ${cutoff}`,
        eq(slabMemories.accessCount, 0),
      ),
    )
    .returning({ id: slabMemories.id })

  return result.length
}
