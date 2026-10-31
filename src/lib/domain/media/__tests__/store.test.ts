import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { projectVideos } from "@/db/schema"
import { socialAccounts } from "@/db/schema-social"
import {
  projectVideoDeleteStatement,
  projectVideoImportStatement,
  socialAccountUpdateStatement,
  socialAccountUpsertStatement,
} from "@/lib/domain/media/store"

// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

type Sql = { readonly sql: string; readonly params: unknown[] }
type Buildable = { toSQL(): Sql }

function sqlOf(statement: unknown): Sql {
  return (statement as Buildable).toSQL()
}

const video = {
  id: "v1",
  organizationId: "o1",
  projectId: "p1",
  title: "Pour",
  department: "O",
  youtubeChannelKey: "hps",
  compassAudience: "staff",
  youtubePrivacy: "private",
  publishStatus: "pending_review",
  sourceSystem: "gmail",
  sourceExternalId: "m1",
  sourceFileName: "pour.mp4",
  sourceMimeType: "video/mp4",
  sourceFileSize: 10,
  driveFileId: "d1",
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
} as const

describe("media store", () => {
  it("keeps the email import idempotent on the source message", () => {
    expect(sqlOf(projectVideoImportStatement(db, video))).toEqual(
      db
        .insert(projectVideos)
        .values(video)
        .onConflictDoNothing({ target: [projectVideos.sourceSystem, projectVideos.sourceExternalId] })
        .toSQL()
    )
  })

  it("soft-deletes a video scoped to its project", () => {
    const now = "2026-10-31T01:00:00.000Z"
    expect(sqlOf(projectVideoDeleteStatement(db, { videoId: "v1", projectId: "p1", now }))).toEqual(
      db
        .update(projectVideos)
        .set({ publishStatus: "deleted", deletedAt: now, updatedAt: now })
        .where(and(eq(projectVideos.id, "v1"), eq(projectVideos.projectId, "p1")))
        .toSQL()
    )
  })

  it("upserts social accounts on organization, department and platform with the caller's update", () => {
    const values = {
      id: "a1",
      organizationId: "o1",
      department: "O",
      platform: "x",
      externalAccountId: "x1",
      accountName: "@hps",
      accessTokenEncrypted: "enc",
      grantedScopes: "tweet.write",
      status: "connected",
      connectedAt: "t",
      createdAt: "t",
      updatedAt: "t",
    } as const
    const update = { accountName: "@hps", status: "connected", lastError: null, updatedAt: "t" } as const
    expect(sqlOf(socialAccountUpsertStatement(db, { values, update }))).toEqual(
      db
        .insert(socialAccounts)
        .values(values)
        .onConflictDoUpdate({
          target: [socialAccounts.organizationId, socialAccounts.department, socialAccounts.platform],
          set: update,
        })
        .toSQL()
    )
    expect(sqlOf(socialAccountUpdateStatement(db, "a1", { lastError: null }))).toEqual(
      db.update(socialAccounts).set({ lastError: null }).where(eq(socialAccounts.id, "a1")).toSQL()
    )
  })
})
