import { describe, it, expect } from "vitest"
import {
  detectConflict,
  resolveConflict,
  createConflictData,
  serializeConflictData,
  parseConflictData,
  needsManualResolution,
  getConflictSummary,
  ConflictStrategy,
  type ConflictStrategyType,
} from "../conflict"

describe("detectConflict", () => {
  it("detects no conflict when local is before remote", () => {
    const localClock = JSON.stringify({ clientA: 1 })
    const remoteClock = JSON.stringify({ clientA: 2 })

    const result = detectConflict(localClock, remoteClock)

    expect(result.hasConflict).toBe(false)
    expect(result.comparison).toBe("before")
  })

  it("detects no conflict when local is after remote", () => {
    const localClock = JSON.stringify({ clientA: 3 })
    const remoteClock = JSON.stringify({ clientA: 2 })

    const result = detectConflict(localClock, remoteClock)

    expect(result.hasConflict).toBe(false)
    expect(result.comparison).toBe("after")
  })

  it("detects no conflict when clocks are equal", () => {
    const localClock = JSON.stringify({ clientA: 2, clientB: 3 })
    const remoteClock = JSON.stringify({ clientA: 2, clientB: 3 })

    const result = detectConflict(localClock, remoteClock)

    expect(result.hasConflict).toBe(false)
    expect(result.comparison).toBe("equal")
  })

  it("detects conflict when clocks are concurrent", () => {
    const localClock = JSON.stringify({ clientA: 2, clientB: 1 })
    const remoteClock = JSON.stringify({ clientA: 1, clientB: 2 })

    const result = detectConflict(localClock, localClock)
    // Actually test concurrent case
    const concurrentResult = detectConflict(localClock, remoteClock)

    expect(concurrentResult.hasConflict).toBe(true)
    expect(concurrentResult.comparison).toBe("concurrent")
  })

  it("handles invalid JSON gracefully", () => {
    const result = detectConflict("invalid", "also-invalid")

    expect(result.localClock).toEqual({})
    expect(result.remoteClock).toEqual({})
    expect(result.comparison).toBe("equal")
  })

  it("handles empty clocks", () => {
    const result = detectConflict("{}", "{}")

    expect(result.hasConflict).toBe(false)
    expect(result.comparison).toBe("equal")
  })
})

describe("resolveConflict", () => {
  const localData = { id: "1", name: "Local Version", value: 100 }
  const remoteData = { id: "1", name: "Remote Version", value: 200 }
  const localClock = { clientA: 2, clientB: 1 }
  const remoteClock = { clientA: 1, clientB: 2 }

  describe("LOCAL_WINS strategy", () => {
    it("always uses local data", () => {
      const result = resolveConflict(
        ConflictStrategy.LOCAL_WINS,
        localData,
        remoteData,
        localClock,
        remoteClock,
        "2024-01-01T10:00:00Z",
        "2024-01-01T11:00:00Z"
      )

      expect(result.resolution).toBe("use_local")
      expect(result.data).toEqual(localData)
      expect(result.reason).toBe("Local wins strategy applied")
    })
  })

  describe("REMOTE_WINS strategy", () => {
    it("always uses remote data", () => {
      const result = resolveConflict(
        ConflictStrategy.REMOTE_WINS,
        localData,
        remoteData,
        localClock,
        remoteClock,
        "2024-01-01T10:00:00Z",
        "2024-01-01T11:00:00Z"
      )

      expect(result.resolution).toBe("use_remote")
      expect(result.data).toEqual(remoteData)
      expect(result.reason).toBe("Remote wins strategy applied")
    })
  })

  describe("MANUAL_REVIEW strategy", () => {
    it("flags for manual review", () => {
      const result = resolveConflict(
        ConflictStrategy.MANUAL_REVIEW,
        localData,
        remoteData,
        localClock,
        remoteClock,
        "2024-01-01T10:00:00Z",
        "2024-01-01T11:00:00Z"
      )

      expect(result.resolution).toBe("flag_manual")
      expect(result.localData).toEqual(localData)
      expect(result.remoteData).toEqual(remoteData)
      expect(result.reason).toBe("Flagged for manual review per strategy")
    })
  })

  describe("NEWEST_WINS strategy", () => {
    it("uses remote when newer", () => {
      const result = resolveConflict(
        ConflictStrategy.NEWEST_WINS,
        localData,
        remoteData,
        localClock,
        remoteClock,
        "2024-01-01T10:00:00Z",
        "2024-01-01T11:00:00Z"
      )

      expect(result.resolution).toBe("use_remote")
      expect(result.data).toEqual(remoteData)
      expect(result.reason).toContain("Remote is newer")
    })

    it("uses local when newer", () => {
      const result = resolveConflict(
        ConflictStrategy.NEWEST_WINS,
        localData,
        remoteData,
        localClock,
        remoteClock,
        "2024-01-01T12:00:00Z",
        "2024-01-01T11:00:00Z"
      )

      expect(result.resolution).toBe("use_local")
      expect(result.data).toEqual(localData)
      expect(result.reason).toContain("Local is newer")
    })

    it("uses remote when timestamps are equal", () => {
      const result = resolveConflict(
        ConflictStrategy.NEWEST_WINS,
        localData,
        remoteData,
        localClock,
        remoteClock,
        "2024-01-01T10:00:00Z",
        "2024-01-01T10:00:00Z"
      )

      expect(result.resolution).toBe("use_remote")
    })

    it("uses remote when no local timestamp", () => {
      const result = resolveConflict(
        ConflictStrategy.NEWEST_WINS,
        localData,
        remoteData,
        localClock,
        remoteClock,
        null,
        "2024-01-01T11:00:00Z"
      )

      expect(result.resolution).toBe("use_remote")
      expect(result.reason).toBe("No local timestamp available")
    })

    it("uses local when no remote timestamp", () => {
      const result = resolveConflict(
        ConflictStrategy.NEWEST_WINS,
        localData,
        remoteData,
        localClock,
        remoteClock,
        "2024-01-01T10:00:00Z",
        null
      )

      expect(result.resolution).toBe("use_local")
      expect(result.reason).toBe("No remote timestamp available")
    })

    it("falls back to clock comparison when no timestamps", () => {
      const result = resolveConflict(
        ConflictStrategy.NEWEST_WINS,
        localData,
        remoteData,
        { clientA: 3 }, // local is after
        { clientA: 2 },
        null,
        null
      )

      expect(result.resolution).toBe("use_local")
      expect(result.reason).toBe("Local clock is ahead")
    })

    it("defaults to remote when no timestamps and clocks are concurrent", () => {
      const result = resolveConflict(
        ConflictStrategy.NEWEST_WINS,
        localData,
        remoteData,
        { clientA: 2, clientB: 1 },
        { clientA: 1, clientB: 2 },
        null,
        null
      )

      expect(result.resolution).toBe("use_remote")
      expect(result.reason).toContain("default")
    })
  })
})

describe("createConflictData", () => {
  it("creates conflict data with all fields", () => {
    const local = { id: "1", name: "Local" }
    const remote = { id: "1", name: "Remote" }
    const localClock = { clientA: 2 }
    const remoteClock = { clientB: 2 }

    const data = createConflictData(
      local,
      remote,
      localClock,
      remoteClock,
      "2024-01-01T10:00:00Z",
      "2024-01-01T11:00:00Z",
      "Concurrent modification detected"
    )

    expect(data.local).toEqual(local)
    expect(data.remote).toEqual(remote)
    expect(data.localClock).toEqual(localClock)
    expect(data.remoteClock).toEqual(remoteClock)
    expect(data.localModifiedAt).toBe("2024-01-01T10:00:00Z")
    expect(data.remoteModifiedAt).toBe("2024-01-01T11:00:00Z")
    expect(data.reason).toBe("Concurrent modification detected")
    expect(data.detectedAt).toBeDefined()
  })
})

describe("serializeConflictData / parseConflictData", () => {
  it("round-trips conflict data", () => {
    const original = createConflictData(
      { id: "1", name: "Local" },
      { id: "1", name: "Remote" },
      { clientA: 2 },
      { clientB: 2 },
      "2024-01-01T10:00:00Z",
      "2024-01-01T11:00:00Z",
      "Test conflict"
    )

    const serialized = serializeConflictData(original)
    const parsed = parseConflictData(serialized)

    expect(parsed).toEqual(original)
  })

  it("returns null for invalid JSON", () => {
    expect(parseConflictData("invalid")).toBeNull()
  })
})

describe("needsManualResolution", () => {
  it("returns true when status is conflict and data exists", () => {
    expect(needsManualResolution("conflict", '{"reason":"test"}')).toBe(true)
  })

  it("returns false when status is not conflict", () => {
    expect(needsManualResolution("pending_sync", '{"reason":"test"}')).toBe(false)
  })

  it("returns false when no conflict data", () => {
    expect(needsManualResolution("conflict", null)).toBe(false)
  })
})

describe("getConflictSummary", () => {
  it("extracts summary fields from conflict data", () => {
    const conflictData = createConflictData(
      { id: "1" },
      { id: "1" },
      { clientA: 1 },
      { clientB: 1 },
      "2024-01-01T10:00:00Z",
      "2024-01-01T11:00:00Z",
      "Test reason"
    )

    const summary = getConflictSummary(JSON.stringify(conflictData))

    expect(summary).toEqual({
      localModified: "2024-01-01T10:00:00Z",
      remoteModified: "2024-01-01T11:00:00Z",
      detectedAt: conflictData.detectedAt,
      reason: "Test reason",
    })
  })

  it("returns null for invalid JSON", () => {
    expect(getConflictSummary("invalid")).toBeNull()
  })
})
