import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { SyncEngine, createSyncEngine } from "../engine"
import { createMemoryProvider } from "@/db/provider/memory-provider"
import type { DatabaseProvider } from "@/db/provider/interface"
import { ConflictStrategy } from "../conflict"
import type { RemoteRecord } from "../engine"

// Sync schema table definitions for in-memory database
const SYNC_SCHEMA = `
  CREATE TABLE IF NOT EXISTS local_sync_metadata (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    vector_clock TEXT NOT NULL,
    last_modified_at TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'pending_sync',
    conflict_data TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mutation_queue (
    id TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    payload TEXT,
    vector_clock TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_checkpoint (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL UNIQUE,
    last_sync_cursor TEXT,
    local_vector_clock TEXT,
    synced_at TEXT NOT NULL
  );
`

// Helper to set up sync tables
async function setupSyncTables(provider: DatabaseProvider) {
  const statements = SYNC_SCHEMA.split(";").filter((s) => s.trim())
  for (const stmt of statements) {
    await provider.execute(stmt)
  }
}

// Mock data for testing
interface TestRecord {
  id: string
  name: string
  value: number
  updatedAt: string
  vectorClock?: string
}

describe("SyncEngine", () => {
  let provider: DatabaseProvider
  let engine: SyncEngine

  beforeEach(async () => {
    provider = createMemoryProvider()
    await setupSyncTables(provider)

    engine = createSyncEngine(provider, {
      clientId: "test-client",
      conflictStrategy: ConflictStrategy.NEWEST_WINS,
      tables: ["test_table"],
    })
    await engine.initialize()
  })

  afterEach(async () => {
    await provider.close?.()
  })

  describe("initialization", () => {
    it("creates engine with correct config", () => {
      expect(engine).toBeInstanceOf(SyncEngine)
    })

    it("can be initialized multiple times safely", async () => {
      await engine.initialize()
      await engine.initialize()
    })
  })

  describe("pull", () => {
    it("creates new records from remote", async () => {
      const remoteRecords: RemoteRecord[] = [
        {
          id: "remote-1",
          name: "Remote Record",
          value: 100,
          updatedAt: "2024-01-01T10:00:00Z",
          vectorClock: JSON.stringify({ server: 1 }),
        },
      ]

      const fetchRemote = vi.fn().mockResolvedValue({
        records: remoteRecords,
        nextCursor: "cursor-1",
      })

      const upsertLocal = vi.fn().mockResolvedValue("local-1")

      const result = await engine.pull(
        "test_table",
        fetchRemote,
        upsertLocal as Parameters<typeof engine.pull>[2]
      )

      expect(result.created).toBe(1)
      expect(result.updated).toBe(0)
      expect(result.conflicts).toBe(0)
      expect(result.errors).toHaveLength(0)
      expect(fetchRemote).toHaveBeenCalledWith("test_table", null)
      expect(upsertLocal).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          id: "remote-1",
          name: "Remote Record",
        })
      )
    })

    it("updates existing records from remote", async () => {
      // First, create a local record
      await engine.recordMutation("test_table", "insert", "record-1", {
        id: "record-1",
        name: "Local Version",
        value: 50,
      })

      const remoteRecords: RemoteRecord[] = [
        {
          id: "record-1",
          name: "Remote Version",
          value: 100,
          updatedAt: "2024-01-01T11:00:00Z",
          vectorClock: JSON.stringify({ server: 2 }),
        },
      ]

      const fetchRemote = vi.fn().mockResolvedValue({
        records: remoteRecords,
        nextCursor: "cursor-1",
      })

      const upsertLocal = vi.fn().mockResolvedValue("record-1")

      const result = await engine.pull(
        "test_table",
        fetchRemote,
        upsertLocal as Parameters<typeof engine.pull>[2]
      )

      expect(result.updated).toBe(1)
      expect(result.created).toBe(0)
    })

    it("handles multiple records", async () => {
      const remoteRecords: RemoteRecord[] = [
        { id: "r1", name: "Record 1", value: 1, updatedAt: "2024-01-01T10:00:00Z" },
        { id: "r2", name: "Record 2", value: 2, updatedAt: "2024-01-01T10:01:00Z" },
        { id: "r3", name: "Record 3", value: 3, updatedAt: "2024-01-01T10:02:00Z" },
      ]

      const fetchRemote = vi.fn().mockResolvedValue({
        records: remoteRecords,
        nextCursor: "cursor-1",
      })

      const upsertLocal = vi.fn().mockResolvedValue("id")

      const result = await engine.pull(
        "test_table",
        fetchRemote,
        upsertLocal as Parameters<typeof engine.pull>[2]
      )

      expect(result.created).toBe(3)
    })

    it("captures errors during pull", async () => {
      const remoteRecords: RemoteRecord[] = [
        { id: "good", name: "Good", value: 1, updatedAt: "2024-01-01T10:00:00Z" },
        { id: "bad", name: "Bad", value: 2, updatedAt: "2024-01-01T10:01:00Z" },
      ]

      const fetchRemote = vi.fn().mockResolvedValue({
        records: remoteRecords,
        nextCursor: null,
      })

      const upsertLocal = vi
        .fn()
        .mockResolvedValueOnce("good-id")
        .mockRejectedValueOnce(new Error("Insert failed"))

      const result = await engine.pull(
        "test_table",
        fetchRemote,
        upsertLocal as Parameters<typeof engine.pull>[2]
      )

      expect(result.created).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.recordId).toBe("bad")
      expect(result.errors[0]?.error).toBe("Insert failed")
    })

    it("uses checkpoint for incremental sync", async () => {
      const fetchRemote = vi.fn().mockResolvedValue({
        records: [],
        nextCursor: "cursor-2",
      })

      // First sync
      await engine.pull("test_table", fetchRemote, vi.fn().mockResolvedValue("id"))

      // Second sync should use cursor
      fetchRemote.mockClear()
      fetchRemote.mockResolvedValue({ records: [], nextCursor: "cursor-3" })

      await engine.pull("test_table", fetchRemote, vi.fn().mockResolvedValue("id"))

      expect(fetchRemote).toHaveBeenCalledWith("test_table", "cursor-2")
    })
  })

  describe("push", () => {
    it("pushes pending mutations", async () => {
      await engine.recordMutation("test_table", "insert", "record-1", {
        id: "record-1",
        name: "New Record",
      })

      const getLocalRecord = vi.fn().mockResolvedValue({
        id: "record-1",
        name: "New Record",
      })

      const pushMutation = vi.fn().mockResolvedValue(true)

      const result = await engine.push(
        "test_table",
        getLocalRecord as Parameters<typeof engine.push>[1],
        pushMutation
      )

      expect(result.pushed).toBe(1)
      expect(result.failed).toBe(0)
      expect(pushMutation).toHaveBeenCalledWith(
        "test_table",
        "insert",
        "record-1",
        { id: "record-1", name: "New Record" },
        expect.any(Object)
      )
    })

    it("handles push failures", async () => {
      await engine.recordMutation("test_table", "insert", "record-1", {
        id: "record-1",
        name: "New Record",
      })

      const getLocalRecord = vi.fn().mockResolvedValue({
        id: "record-1",
        name: "New Record",
      })

      const pushMutation = vi.fn().mockResolvedValue(false)

      const result = await engine.push(
        "test_table",
        getLocalRecord as Parameters<typeof engine.push>[1],
        pushMutation
      )

      expect(result.pushed).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0]?.recordId).toBe("record-1")
    })

    it("handles push exceptions", async () => {
      await engine.recordMutation("test_table", "insert", "record-1", {
        id: "record-1",
        name: "New Record",
      })

      const getLocalRecord = vi.fn().mockResolvedValue({
        id: "record-1",
        name: "New Record",
      })

      const pushMutation = vi.fn().mockRejectedValue(new Error("Network error"))

      const result = await engine.push(
        "test_table",
        getLocalRecord as Parameters<typeof engine.push>[1],
        pushMutation
      )

      expect(result.failed).toBe(1)
      expect(result.errors[0]?.error).toBe("Network error")
    })

    it("filters by table name", async () => {
      await engine.recordMutation("test_table", "insert", "record-1", { id: "record-1" })
      await engine.recordMutation("other_table", "insert", "record-2", { id: "record-2" })

      const pushMutation = vi.fn().mockResolvedValue(true)

      await engine.push("test_table", vi.fn().mockResolvedValue({}), pushMutation)

      expect(pushMutation).toHaveBeenCalledTimes(1)
      expect(pushMutation).toHaveBeenCalledWith(
        "test_table",
        "insert",
        "record-1",
        expect.any(Object),
        expect.any(Object)
      )
    })
  })

  describe("sync (full cycle)", () => {
    it("performs pull then push", async () => {
      const remoteRecords: RemoteRecord[] = [
        { id: "remote-1", name: "From Remote", value: 1, updatedAt: "2024-01-01T10:00:00Z" },
      ]

      const fetchRemote = vi.fn().mockResolvedValue({
        records: remoteRecords,
        nextCursor: "cursor-1",
      })

      const upsertLocal = vi.fn().mockResolvedValue("id")
      const getLocalRecord = vi.fn().mockResolvedValue({})
      const pushMutation = vi.fn().mockResolvedValue(true)

      // Add a local mutation to push
      await engine.recordMutation("test_table", "insert", "local-1", {
        id: "local-1",
        name: "From Local",
      })

      const result = await engine.sync(
        "test_table",
        fetchRemote,
        upsertLocal as Parameters<typeof engine.sync>[2],
        getLocalRecord as Parameters<typeof engine.sync>[3],
        pushMutation
      )

      expect(result.pulled).toBe(1) // 1 created
      expect(result.pushed).toBe(1) // 1 pushed
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe("recordMutation", () => {
    it("records a mutation with vector clock", async () => {
      await engine.recordMutation("test_table", "insert", "record-1", {
        id: "record-1",
        name: "Test",
      })

      const status = await engine.getRecordStatus("test_table", "record-1")

      expect(status).toBeDefined()
      expect(status?.recordId).toBe("record-1")
      expect(status?.syncStatus).toBe("pending_sync")
    })

    it("increments vector clock on subsequent mutations", async () => {
      await engine.recordMutation("test_table", "insert", "record-1", { id: "record-1" })
      const status1 = await engine.getRecordStatus("test_table", "record-1")

      await engine.recordMutation("test_table", "update", "record-1", {
        id: "record-1",
        updated: true,
      })
      const status2 = await engine.getRecordStatus("test_table", "record-1")

      const clock1 = JSON.parse(status1?.vectorClock ?? "{}")
      const clock2 = JSON.parse(status2?.vectorClock ?? "{}")

      expect(clock2["test-client"]).toBeGreaterThan(clock1["test-client"])
    })
  })

  describe("conflict handling", () => {
    it("can retrieve empty conflicts list", async () => {
      const conflicts = await engine.getConflicts()
      expect(conflicts).toEqual([])
    })

    it("throws when resolving non-existent conflict", async () => {
      await expect(
        engine.resolveConflict("test_table", "nonexistent", "use_local")
      ).rejects.toThrow("No conflict found for this record")
    })
  })

  describe("background sync", () => {
    it("can start and stop background sync", () => {
      const handler = vi.fn().mockResolvedValue(true)

      engine.startBackgroundSync(handler)
      engine.stopBackgroundSync()

      // No error means success
    })

    it("throws if not initialized", () => {
      const uninitializedEngine = createSyncEngine(provider, {
        clientId: "test",
        conflictStrategy: ConflictStrategy.NEWEST_WINS,
        tables: [],
      })

      expect(() => uninitializedEngine.startBackgroundSync(vi.fn())).toThrow("not initialized")
    })
  })
})
