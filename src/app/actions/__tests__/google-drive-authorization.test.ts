import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getActiveOrganization: vi.fn(),
  requirePermission: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  getCurrentUser: mocks.requireAuth,
}))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-access", () => ({
  getActiveOrganization: mocks.getActiveOrganization,
}))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  createDriveFolder,
  getDriveStorageQuota,
  getUploadSessionUrl,
  listDriveFiles,
  listProjectDriveFilesForField,
  listProjectDriveFolderForField,
  searchDriveFiles,
  updateUserGoogleEmail,
} from "@/app/actions/google-drive"

const externalUser = {
  id: "external-1",
  email: "external@example.com",
  isActive: true,
  organizationId: "org-client",
  organizationType: "client",
  role: "client",
} as const

const internalUser = {
  ...externalUser,
  id: "staff-1",
  organizationId: "org-internal",
  organizationType: "internal",
  role: "admin",
} as const

function createUpdateDatabase(changes: number) {
  const run = vi.fn().mockResolvedValue({ meta: { changes } })
  const where = vi.fn(() => ({ run }))
  const set = vi.fn(() => ({ where }))
  return {
    update: vi.fn(() => ({ set })),
    run,
    where,
  }
}

type SelectQuery = {
  readonly from: () => SelectQuery
  readonly where: (condition: unknown) => SelectQuery
  readonly limit: () => SelectQuery
  readonly then: <TResult1 = readonly Record<string, unknown>[], TResult2 = never>(
    onfulfilled?:
      | ((value: readonly Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>
}

function sqlContains(value: unknown, expected: string): boolean {
  if (value === expected) return true
  if (value === null || typeof value !== "object") return false

  const chunks = Reflect.get(value, "queryChunks")
  if (Array.isArray(chunks) && chunks.some((chunk) => sqlContains(chunk, expected))) {
    return true
  }

  return sqlContains(Reflect.get(value, "value"), expected)
}

function createFieldDatabase() {
  let selectCount = 0
  const conditions: unknown[] = []
  const query: SelectQuery = {
    from: () => query,
    where: (condition) => {
      conditions.push(condition)
      return query
    },
    limit: () => query,
    then: (onfulfilled, onrejected) => {
      selectCount += 1
      const rows =
        selectCount === 1
          ? [{ projectId: "project-1" }]
          : selectCount === 2
            ? [{ folderId: "folder-1" }]
            : []
      return Promise.resolve(rows).then(onfulfilled, onrejected)
    },
  }

  return {
    select: vi.fn(() => query),
    conditions,
  }
}

describe("generic Google Drive Server Action authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue(externalUser)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "db" } })
    mocks.getDb.mockReturnValue({})
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-client",
      type: "client",
    })
  })

  it.each([
    ["list", () => listDriveFiles()],
    ["search", () => searchDriveFiles("confidential")],
    ["create folder", () => createDriveFolder("private")],
    ["quota", () => getDriveStorageQuota()],
    ["upload session", () => getUploadSessionUrl("private.txt", "text/plain")],
  ])("denies an external caller before permission or provider work for %s", async (_label, action) => {
    const result = await action()

    expect(result).toMatchObject({ success: false })
    expect(mocks.requireAuth).toHaveBeenCalledTimes(1)
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
    expect(mocks.getActiveOrganization).not.toHaveBeenCalled()
    expect(mocks.requirePermission).not.toHaveBeenCalled()
  })

  it("denies an inactive internal caller before permission or provider work", async () => {
    mocks.requireAuth.mockResolvedValue({
      ...externalUser,
      isActive: false,
      organizationId: "org-internal",
      organizationType: "internal",
      role: "admin",
    })
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-internal",
      type: "internal",
    })

    const result = await listDriveFiles()

    expect(result).toMatchObject({ success: false })
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
    expect(mocks.getActiveOrganization).not.toHaveBeenCalled()
    expect(mocks.requirePermission).not.toHaveBeenCalled()
  })

  it("does not update a user outside the caller's active organization", async () => {
    const database = createUpdateDatabase(0)
    mocks.requireAuth.mockResolvedValue(internalUser)
    mocks.getDb.mockReturnValue(database)
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-internal",
      type: "internal",
    })

    const result = await updateUserGoogleEmail("user-in-other-org", "other@example.com")

    expect(result).toEqual({ success: false, error: "User not found in active organization" })
    expect(mocks.getActiveOrganization).toHaveBeenCalledWith(database, internalUser)
    expect(database.update).toHaveBeenCalledTimes(1)
  })

  it("binds field project lookup to the caller's active organization", async () => {
    const database = createFieldDatabase()
    mocks.requireAuth.mockResolvedValue(internalUser)
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        DB: "db",
        GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY: "test-key",
      },
    })
    mocks.getDb.mockReturnValue(database)
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-internal",
      type: "internal",
    })

    const result = await listProjectDriveFilesForField("project-1")

    expect(result).toEqual({ success: false, error: "Google Drive not connected" })
    expect(database.conditions).toHaveLength(3)
    expect(sqlContains(database.conditions[1], "org-internal")).toBe(true)
  })

  it("binds field folder lookup to the caller's active organization", async () => {
    const database = createFieldDatabase()
    mocks.requireAuth.mockResolvedValue(internalUser)
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        DB: "db",
        GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY: "test-key",
      },
    })
    mocks.getDb.mockReturnValue(database)
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-internal",
      type: "internal",
    })

    const result = await listProjectDriveFolderForField("project-1", "folder-1")

    expect(result).toEqual({ success: false, error: "Google Drive not connected" })
    expect(database.conditions).toHaveLength(3)
    expect(sqlContains(database.conditions[1], "org-internal")).toBe(true)
  })
})
