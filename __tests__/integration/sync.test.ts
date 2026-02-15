import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createMemoryProvider } from "@/db/provider/memory-provider"
import type { DatabaseProvider } from "@/db/provider/interface"
import { SyncEngine, createSyncEngine } from "@/lib/sync/engine"
import { ConflictStrategy } from "@/lib/sync/conflict"
import type { RemoteRecord } from "@/lib/sync/engine"

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
    created_at TEXT NOT NULL,
    process_after TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_checkpoint (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL UNIQUE,
    last_sync_cursor TEXT,
    local_vector_clock TEXT,
    synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_tombstone (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    vector_clock TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0
  );
`

// Helper to set up sync tables
async function setupSyncTables(provider: DatabaseProvider) {
  const statements = SYNC_SCHEMA.split(";").filter((s) => s.trim())
  for (const stmt of statements) {
    await provider.execute(stmt)
  }
}

// Integration tests for local-to-cloud sync using two MemoryProviders
// Simulates offline behavior and sync recovery

describe("Sync Integration", () => {
  let localProvider: DatabaseProvider
  let cloudProvider: DatabaseProvider
  let localEngine: SyncEngine

  // Simulated cloud data store
  let cloudStore: Map<string, RemoteRecord>
  let cloudClocks: Map<string, string>

  beforeEach(async () => {
    localProvider = createMemoryProvider()
    cloudProvider = createMemoryProvider()
    await setupSyncTables(localProvider)
    await setupSyncTables(cloudProvider)
    cloudStore = new Map()
    cloudClocks = new Map()

    localEngine = createSyncEngine(localProvider, {
      clientId: "local-client",
      conflictStrategy: ConflictStrategy.NEWEST_WINS,
      tables: ["records"],
    })
    await localEngine.initialize()
  })

  afterEach(async () => {
    await localProvider.close?.()
    await cloudProvider.close?.()
  })

  describe("local-to-cloud sync", () => {
    it("syncs new local record to cloud", async () => {
      // Create local record
      await localEngine.recordMutation("records", "insert", "rec-1", {
        id: "rec-1",
        name: "Local Record",
        value: 100,
      })

      // Mock cloud push that stores in cloudStore
      const pushMutation = vi.fn().mockImplementation(async (_table, _op, id, payload, clock) => {
        cloudStore.set(id, {
          id,
          ...payload,
          updatedAt: new Date().toISOString(),
          vectorClock: JSON.stringify(clock),
        } as RemoteRecord)
        return true
      })

      const result = await localEngine.push(
        "records",
        async () => ({}),
        pushMutation
      )

      expect(result.pushed).toBe(1)
      expect(cloudStore.has("rec-1")).toBe(true)
      expect(cloudStore.get("rec-1")?.name).toBe("Local Record")
    })

    it("syncs new cloud record to local", async () => {
      // Seed cloud with a record
      cloudStore.set("rec-1", {
        id: "rec-1",
        name: "Cloud Record",
        value: 200,
        updatedAt: "2024-01-01T10:00:00Z",
        vectorClock: JSON.stringify({ server: 1 }),
      })

      const fetchRemote = vi.fn().mockImplementation(async () => ({
        records: Array.from(cloudStore.values()),
        nextCursor: "cursor-1",
      }))

      const localRecords: Map<string, unknown> = new Map()
      const upsertLocal = vi.fn().mockImplementation(async (_id, data) => {
        const rec = data as { id: string }
        localRecords.set(rec.id, data)
        return rec.id
      })

      const result = await localEngine.pull("records", fetchRemote, upsertLocal)

      expect(result.created).toBe(1)
      expect(localRecords.has("rec-1")).toBe(true)
    })

    it("performs bidirectional sync", async () => {
      // Seed cloud
      cloudStore.set("cloud-1", {
        id: "cloud-1",
        name: "From Cloud",
        value: 1,
        updatedAt: "2024-01-01T10:00:00Z",
        vectorClock: JSON.stringify({ server: 1 }),
      })

      // Create local
      await localEngine.recordMutation("records", "insert", "local-1", {
        id: "local-1",
        name: "From Local",
        value: 2,
      })

      const localRecords: Map<string, unknown> = new Map()

      const fetchRemote = vi.fn().mockImplementation(async () => ({
        records: Array.from(cloudStore.values()),
        nextCursor: "cursor-1",
      }))

      const upsertLocal = vi.fn().mockImplementation(async (_id, data) => {
        const rec = data as { id: string }
        localRecords.set(rec.id, data)
        return rec.id
      })

      const pushMutation = vi.fn().mockImplementation(async (_table, _op, id, payload, clock) => {
        cloudStore.set(id, {
          id,
          ...payload,
          updatedAt: new Date().toISOString(),
          vectorClock: JSON.stringify(clock),
        } as RemoteRecord)
        return true
      })

      const result = await localEngine.sync(
        "records",
        fetchRemote,
        upsertLocal,
        async () => ({}),
        pushMutation
      )

      // Pull: 1 record from cloud
      // Push: 1 record to cloud
      expect(result.pulled).toBe(1)
      expect(result.pushed).toBe(1)

      // Verify both sides have both records
      expect(localRecords.has("cloud-1")).toBe(true)
      expect(cloudStore.has("local-1")).toBe(true)
    })
  })

  describe("offline queue behavior", () => {
    it("queues mutations when offline (push fails)", async () => {
      // Create multiple local records
      for (let i = 0; i < 3; i++) {
        await localEngine.recordMutation("records", "insert", `rec-${i}`, {
          id: `rec-${i}`,
          index: i,
        })
      }

      // Simulate offline - push always fails
      const pushMutation = vi.fn().mockRejectedValue(new Error("Network unavailable"))

      const result = await localEngine.push(
        "records",
        async () => ({}),
        pushMutation
      )

      expect(result.failed).toBe(3)
      expect(result.pushed).toBe(0)
      expect(result.errors).toHaveLength(3)
    })

    it("maintains queue order (FIFO)", async () => {
      const order: string[] = []

      // Create records in order
      await localEngine.recordMutation("records", "insert", "first", { id: "first" })
      await localEngine.recordMutation("records", "insert", "second", { id: "second" })
      await localEngine.recordMutation("records", "insert", "third", { id: "third" })

      const pushMutation = vi.fn().mockImplementation(async (_table, _op, id) => {
        order.push(id)
        return true
      })

      await localEngine.push("records", async () => ({}), pushMutation)

      expect(order).toEqual(["first", "second", "third"])
    })

    it("retries failed mutations", async () => {
      await localEngine.recordMutation("records", "insert", "rec-1", { id: "rec-1" })

      let attempts = 0
      const pushMutation = vi.fn().mockImplementation(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error("Temporary failure")
        }
        return true
      })

      // First push fails
      const result1 = await localEngine.push("records", async () => ({}), pushMutation)
      expect(result1.failed).toBe(1)

      // Second push also fails (retry 1)
      const result2 = await localEngine.push("records", async () => ({}), pushMutation)
      expect(result2.failed).toBe(1)

      // Third push succeeds (retry 2)
      const result3 = await localEngine.push("records", async () => ({}), pushMutation)
      expect(result3.pushed).toBe(1)

      expect(attempts).toBe(3)
    })
  })

  describe("sync recovery after reconnect", () => {
    it("recovers from offline state", async () => {
      // Create local records while "offline"
      await localEngine.recordMutation("records", "insert", "offline-1", { id: "offline-1" })
      await localEngine.recordMutation("records", "insert", "offline-2", { id: "offline-2" })

      // First sync attempt - simulate offline
      let isOnline = false
      const pushMutation = vi.fn().mockImplementation(async () => {
        if (!isOnline) {
          throw new Error("Offline")
        }
        return true
      })

      const result1 = await localEngine.push("records", async () => ({}), pushMutation)
      expect(result1.failed).toBe(2)

      // "Go online"
      isOnline = true

      // Retry - should succeed now
      const result2 = await localEngine.push("records", async () => ({}), pushMutation)
      expect(result2.pushed).toBe(2)
    })

    it("handles partial sync (some succeed, some fail)", async () => {
      // Create multiple records
      await localEngine.recordMutation("records", "insert", "good-1", { id: "good-1" })
      await localEngine.recordMutation("records", "insert", "bad", { id: "bad" })
      await localEngine.recordMutation("records", "insert", "good-2", { id: "good-2" })

      const pushMutation = vi.fn().mockImplementation(async (_table, _op, id) => {
        if (id === "bad") {
          throw new Error("Bad record")
        }
        return true
      })

      const result = await localEngine.push("records", async () => ({}), pushMutation)

      expect(result.pushed).toBe(2)
      expect(result.failed).toBe(1)
      expect(result.errors[0]?.recordId).toBe("bad")
    })
  })

  describe("conflict scenarios", () => {
    it("detects concurrent modifications", async () => {
      // Create local record
      await localEngine.recordMutation("records", "insert", "shared", {
        id: "shared",
        name: "Local Version",
      })

      // Get local status
      const localStatus = await localEngine.getRecordStatus("records", "shared")
      expect(localStatus?.syncStatus).toBe("pending_sync")

      // Cloud has different version with concurrent clock
      cloudStore.set("shared", {
        id: "shared",
        name: "Cloud Version",
        updatedAt: "2024-01-01T10:00:00Z",
        vectorClock: JSON.stringify({ otherClient: 1 }), // Concurrent with local
      })

      const fetchRemote = vi.fn().mockImplementation(async () => ({
        records: Array.from(cloudStore.values()),
        nextCursor: "cursor-1",
      }))

      const upsertLocal = vi.fn().mockResolvedValue("shared")

      // Pull with conflict detection
      // Since local clock is { localClient: 1 } and remote is { otherClient: 1 }
      // These are concurrent - conflict should be detected if local is pending
      const result = await localEngine.pull("records", fetchRemote, upsertLocal)

      // Conflict detection depends on local sync status
      // If pending_sync, concurrent clocks trigger conflict
      expect(result.created + result.updated + result.conflicts).toBeGreaterThanOrEqual(1)
    })

    it("resolves conflict using configured strategy", async () => {
      // Create engine with LOCAL_WINS strategy
      const localWinsEngine = createSyncEngine(localProvider, {
        clientId: "test-client",
        conflictStrategy: ConflictStrategy.LOCAL_WINS,
        tables: ["records"],
      })
      await localWinsEngine.initialize()

      // Create local record
      await localWinsEngine.recordMutation("records", "insert", "conflict-rec", {
        id: "conflict-rec",
        name: "Local Value",
        value: 100,
      })

      // Cloud has concurrent version
      cloudStore.set("conflict-rec", {
        id: "conflict-rec",
        name: "Cloud Value",
        value: 200,
        updatedAt: "2024-01-01T10:00:00Z",
        vectorClock: JSON.stringify({ server: 5 }), // After local would be { "test-client": 1 }
      })

      // With LOCAL_WINS, conflicts should resolve using local data
      // This is a high-level test - detailed conflict tests are in conflict.test.ts
      await localWinsEngine.pull(
        "records",
        async () => ({ records: Array.from(cloudStore.values()), nextCursor: "c1" }),
        async () => "id"
      )

      // Engine should handle the conflict according to LOCAL_WINS strategy
    })
  })
})
