import { NextRequest, NextResponse } from "next/server"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { z } from "zod/v4"
import { getCurrentUser } from "@/lib/auth"
import { syncCheckpoint } from "@/lib/sync/schema"
import { serializeClock, type VectorClockValue } from "@/lib/sync/clock"

const VectorClockSchema = z.record(z.string(), z.number())

const UpdateCheckpointSchema = z.object({
  tableName: z.string(),
  cursor: z.string(),
  localVectorClock: VectorClockSchema.optional(),
})

type CheckpointResponse = {
  checkpoints: Array<{
    tableName: string
    lastSyncCursor: string | null
    localVectorClock: VectorClockValue | null
    syncedAt: string
  }>
}

type UpdateResponse =
  | { success: true }
  | { error: "invalid request"; details?: unknown }
  | { error: "unauthorized" }

export async function GET(): Promise<NextResponse<CheckpointResponse | { error: string }>> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { env } = await getCloudflareContext()
  const db = drizzle(env.DB)

  const checkpoints = await db
    .select()
    .from(syncCheckpoint)

  const response: CheckpointResponse = {
    checkpoints: checkpoints.map((cp) => ({
      tableName: cp.tableName,
      lastSyncCursor: cp.lastSyncCursor,
      localVectorClock: cp.localVectorClock
        ? (JSON.parse(cp.localVectorClock) as VectorClockValue)
        : null,
      syncedAt: cp.syncedAt,
    })),
  }

  return NextResponse.json(response)
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<UpdateResponse>> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "invalid request", details: "Invalid JSON body" },
      { status: 400 },
    )
  }

  const parseResult = UpdateCheckpointSchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "invalid request", details: parseResult.error.issues },
      { status: 400 },
    )
  }

  const { tableName, cursor, localVectorClock } = parseResult.data

  const { env } = await getCloudflareContext()
  const db = drizzle(env.DB)

  const now = new Date().toISOString()

  const existing = await db
    .select()
    .from(syncCheckpoint)
    .where(eq(syncCheckpoint.tableName, tableName))
    .limit(1)

  const clockJson = localVectorClock
    ? serializeClock(localVectorClock)
    : null

  if (existing[0]) {
    await db
      .update(syncCheckpoint)
      .set({
        lastSyncCursor: cursor,
        localVectorClock: clockJson,
        syncedAt: now,
      })
      .where(eq(syncCheckpoint.tableName, tableName))
  } else {
    await db.insert(syncCheckpoint).values({
      tableName,
      lastSyncCursor: cursor,
      localVectorClock: clockJson,
      syncedAt: now,
    })
  }

  return NextResponse.json({ success: true })
}
