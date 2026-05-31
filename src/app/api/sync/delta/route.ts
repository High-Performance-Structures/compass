import { NextRequest, NextResponse } from "next/server"
import { getCloudflareContext } from "@/lib/db"
import { drizzle } from "drizzle-orm/d1"
import { eq, and, gt, inArray } from "drizzle-orm"
import { z } from "zod/v4"
import { getCurrentUser } from "@/lib/auth"
import {
  localSyncMetadata,
} from "@/lib/sync/schema"
import {
  projects,
  scheduleTasks,
  taskDependencies,
  users,
  organizations,
  teams,
  groups,
} from "@/db/schema"

const QuerySchema = z.object({
  since: z.string().datetime().optional(),
  tables: z.string().optional(),
})

type TableWithUpdatedAt = {
  id: string
  updatedAt: string
}

type ChangeRecord = {
  table: string
  id: string
  data: Record<string, unknown>
  vectorClock: Record<string, number>
  deleted: boolean
}

type DeltaResponse = {
  changes: ChangeRecord[]
  checkpoint: string
}

const TABLE_FETCHERS = {
  projects: async (
    db: ReturnType<typeof drizzle>,
    since: string | null,
  ) => {
    const conditions = since ? [gt(projects.createdAt, since)] : []
    return db
      .select()
      .from(projects)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
  },
  scheduleTasks: async (
    db: ReturnType<typeof drizzle>,
    since: string | null,
  ) => {
    const conditions = since ? [gt(scheduleTasks.updatedAt, since)] : []
    return db
      .select()
      .from(scheduleTasks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
  },
  taskDependencies: async (
    db: ReturnType<typeof drizzle>,
    _since: string | null,
  ) => {
    return db.select().from(taskDependencies)
  },
  users: async (
    db: ReturnType<typeof drizzle>,
    since: string | null,
  ) => {
    const conditions = since ? [gt(users.updatedAt, since)] : []
    return db
      .select()
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
  },
  organizations: async (
    db: ReturnType<typeof drizzle>,
    since: string | null,
  ) => {
    const conditions = since ? [gt(organizations.updatedAt, since)] : []
    return db
      .select()
      .from(organizations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
  },
  teams: async (
    db: ReturnType<typeof drizzle>,
    since: string | null,
  ) => {
    const conditions = since ? [gt(teams.createdAt, since)] : []
    return db
      .select()
      .from(teams)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
  },
  groups: async (
    db: ReturnType<typeof drizzle>,
    since: string | null,
  ) => {
    const conditions = since ? [gt(groups.createdAt, since)] : []
    return db
      .select()
      .from(groups)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
  },
} as const

type SyncableTable = keyof typeof TABLE_FETCHERS

const SYNCABLE_TABLES = Object.keys(TABLE_FETCHERS) as SyncableTable[]

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const parseResult = QuerySchema.safeParse({
    since: searchParams.get("since") ?? undefined,
    tables: searchParams.get("tables") ?? undefined,
  })

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parseResult.error.issues },
      { status: 400 },
    )
  }

  const { since, tables: tablesParam } = parseResult.data

  let requestedTables: SyncableTable[] = [...SYNCABLE_TABLES]
  if (tablesParam) {
    const tableNames = tablesParam.split(",").map((t) => t.trim())
    requestedTables = tableNames.filter((t): t is SyncableTable =>
      SYNCABLE_TABLES.includes(t as SyncableTable),
    )
    if (requestedTables.length === 0) {
      return NextResponse.json(
        { error: "No valid tables specified" },
        { status: 400 },
      )
    }
  }

  const { env } = await getCloudflareContext()
  const db = drizzle(env.DB)

  const changes: ChangeRecord[] = []
  const checkpoint = new Date().toISOString()

  for (const tableName of requestedTables) {
    try {
      const tableChanges = await fetchTableChanges(
        db,
        tableName,
        since ?? null,
      )
      changes.push(...tableChanges)
    } catch (err) {
      console.error(`Error fetching changes for ${tableName}:`, err)
    }
  }

  const response: DeltaResponse = {
    changes,
    checkpoint,
  }

  return NextResponse.json(response)
}

async function fetchTableChanges(
  db: ReturnType<typeof drizzle>,
  tableName: SyncableTable,
  since: string | null,
): Promise<ChangeRecord[]> {
  const fetcher = TABLE_FETCHERS[tableName]
  if (!fetcher) return []

  const records = await fetcher(db, since)
  const changes: ChangeRecord[] = []

  const recordIds = records.map((r) => (r as TableWithUpdatedAt).id)

  if (recordIds.length === 0) return []

  const metadataRecords = await db
    .select()
    .from(localSyncMetadata)
    .where(
      and(
        eq(localSyncMetadata.tableName, tableName),
        inArray(localSyncMetadata.recordId, recordIds),
      ),
    )

  const metadataMap = new Map(
    metadataRecords.map((m) => [m.recordId, m]),
  )

  for (const record of records) {
    const r = record as TableWithUpdatedAt
    const metadata = metadataMap.get(r.id)

    let vectorClock: Record<string, number> = {}

    if (metadata) {
      try {
        vectorClock = JSON.parse(metadata.vectorClock) as Record<string, number>
      } catch {
        vectorClock = {}
      }
    }

    const { id, ...data } = r as TableWithUpdatedAt & Record<string, unknown>

    changes.push({
      table: tableName,
      id,
      data,
      vectorClock,
      deleted: false,
    })
  }

  return changes
}
