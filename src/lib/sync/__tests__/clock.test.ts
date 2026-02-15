import { describe, it, expect, beforeEach } from "vitest"
import {
  VectorClock,
  createVectorClock,
  incrementClock,
  mergeClocks,
  compareClocks,
  serializeClock,
  parseClock,
  type VectorClockValue,
  type ComparisonResult,
} from "../clock"

describe("VectorClock", () => {
  let clock: VectorClock

  beforeEach(() => {
    clock = new VectorClock()
  })

  describe("constructor", () => {
    it("creates empty clock when no initial value", () => {
      expect(clock.isEmpty()).toBe(true)
      expect(clock.getClientIds()).toHaveLength(0)
    })

    it("creates clock from initial value", () => {
      const initial: VectorClockValue = { clientA: 5, clientB: 3 }
      clock = new VectorClock(initial)

      expect(clock.get("clientA")).toBe(5)
      expect(clock.get("clientB")).toBe(3)
      expect(clock.isEmpty()).toBe(false)
    })

    it("creates independent copy from initial value", () => {
      const initial: VectorClockValue = { clientA: 5 }
      clock = new VectorClock(initial)

      initial.clientA = 10

      expect(clock.get("clientA")).toBe(5)
    })
  })

  describe("get", () => {
    it("returns 0 for unknown client", () => {
      expect(clock.get("unknown")).toBe(0)
    })

    it("returns value for known client", () => {
      clock.set("clientA", 5)
      expect(clock.get("clientA")).toBe(5)
    })
  })

  describe("increment", () => {
    it("increments from 0 to 1", () => {
      const result = clock.increment("clientA")

      expect(clock.get("clientA")).toBe(1)
      expect(result).toEqual({ clientA: 1 })
    })

    it("increments existing value", () => {
      clock.set("clientA", 5)
      const result = clock.increment("clientA")

      expect(clock.get("clientA")).toBe(6)
      expect(result).toEqual({ clientA: 6 })
    })

    it("increments multiple clients independently", () => {
      clock.increment("clientA")
      clock.increment("clientA")
      clock.increment("clientB")

      expect(clock.get("clientA")).toBe(2)
      expect(clock.get("clientB")).toBe(1)
    })
  })

  describe("set", () => {
    it("sets value for new client", () => {
      clock.set("clientA", 10)
      expect(clock.get("clientA")).toBe(10)
    })

    it("overwrites existing value", () => {
      clock.set("clientA", 5)
      clock.set("clientA", 10)
      expect(clock.get("clientA")).toBe(10)
    })
  })

  describe("merge", () => {
    it("returns false when no changes", () => {
      clock.set("clientA", 5)
      const changed = clock.merge({ clientA: 3 })

      expect(changed).toBe(false)
      expect(clock.get("clientA")).toBe(5)
    })

    it("returns true and updates when other is greater", () => {
      clock.set("clientA", 3)
      const changed = clock.merge({ clientA: 5 })

      expect(changed).toBe(true)
      expect(clock.get("clientA")).toBe(5)
    })

    it("adds new clients from other", () => {
      clock.set("clientA", 5)
      const changed = clock.merge({ clientB: 3 })

      expect(changed).toBe(true)
      expect(clock.get("clientA")).toBe(5)
      expect(clock.get("clientB")).toBe(3)
    })

    it("takes max for each component", () => {
      clock.set("clientA", 5)
      clock.set("clientB", 2)
      const changed = clock.merge({ clientA: 3, clientB: 4, clientC: 1 })

      expect(changed).toBe(true)
      expect(clock.get("clientA")).toBe(5)
      expect(clock.get("clientB")).toBe(4)
      expect(clock.get("clientC")).toBe(1)
    })
  })

  describe("compare", () => {
    it("returns equal for identical clocks", () => {
      clock.set("clientA", 5)
      expect(clock.compare({ clientA: 5 })).toBe("equal")
    })

    it("returns equal for empty clocks", () => {
      expect(clock.compare({})).toBe("equal")
    })

    it("returns before when all components are less or equal", () => {
      clock.set("clientA", 3)
      expect(clock.compare({ clientA: 5 })).toBe("before")
    })

    it("returns after when all components are greater or equal", () => {
      clock.set("clientA", 5)
      expect(clock.compare({ clientA: 3 })).toBe("after")
    })

    it("returns concurrent when clocks have conflicting changes", () => {
      clock.set("clientA", 5)
      clock.set("clientB", 2)

      const other: VectorClockValue = { clientA: 3, clientB: 4 }
      expect(clock.compare(other)).toBe("concurrent")
    })

    it("handles partial overlap", () => {
      clock.set("clientA", 5)

      expect(clock.compare({ clientA: 5, clientB: 1 })).toBe("before")
    })

    it("returns concurrent for divergent single-client clocks", () => {
      clock.set("clientA", 5)
      expect(clock.compare({ clientB: 5 })).toBe("concurrent")
    })

    it("handles complex concurrent scenarios", () => {
      clock.set("clientA", 5)
      clock.set("clientB", 3)
      clock.set("clientC", 2)

      const other: VectorClockValue = { clientA: 4, clientB: 4, clientC: 1 }
      expect(clock.compare(other)).toBe("concurrent")
    })
  })

  describe("happenedBefore", () => {
    it("returns true when clock is before", () => {
      clock.set("clientA", 3)
      expect(clock.happenedBefore({ clientA: 5 })).toBe(true)
    })

    it("returns false when clocks are concurrent", () => {
      clock.set("clientA", 5)
      expect(clock.happenedBefore({ clientB: 5 })).toBe(false)
    })
  })

  describe("isConcurrentWith", () => {
    it("returns true for concurrent clocks", () => {
      clock.set("clientA", 5)
      expect(clock.isConcurrentWith({ clientB: 5 })).toBe(true)
    })

    it("returns false for ordered clocks", () => {
      clock.set("clientA", 3)
      expect(clock.isConcurrentWith({ clientA: 5 })).toBe(false)
    })
  })

  describe("serialization", () => {
    it("toJSON returns copy of clock", () => {
      clock.set("clientA", 5)
      const json = clock.toJSON()

      expect(json).toEqual({ clientA: 5 })

      clock.set("clientA", 10)
      expect(json.clientA).toBe(5)
    })

    it("toString returns JSON string", () => {
      clock.set("clientA", 5)
      expect(clock.toString()).toBe('{"clientA":5}')
    })

    it("fromString parses valid JSON", () => {
      const parsed = VectorClock.fromString('{"clientA":5,"clientB":3}')

      expect(parsed.get("clientA")).toBe(5)
      expect(parsed.get("clientB")).toBe(3)
    })

    it("fromString returns empty clock for invalid JSON", () => {
      const parsed = VectorClock.fromString("not json")

      expect(parsed.isEmpty()).toBe(true)
    })
  })

  describe("toObject", () => {
    it("returns independent copy", () => {
      clock.set("clientA", 5)
      const obj = clock.toObject()

      clock.set("clientA", 10)
      expect(obj.clientA).toBe(5)
    })
  })
})

describe("Utility functions", () => {
  describe("createVectorClock", () => {
    it("creates clock with one increment", () => {
      const clock = createVectorClock("clientA")
      expect(clock).toEqual({ clientA: 1 })
    })
  })

  describe("incrementClock", () => {
    it("increments existing clock", () => {
      const clock: VectorClockValue = { clientA: 5 }
      const result = incrementClock(clock, "clientA")

      expect(result).toEqual({ clientA: 6 })
    })

    it("does not mutate original", () => {
      const clock: VectorClockValue = { clientA: 5 }
      incrementClock(clock, "clientA")

      expect(clock.clientA).toBe(5)
    })
  })

  describe("mergeClocks", () => {
    it("merges two clocks", () => {
      const a: VectorClockValue = { clientA: 5, clientB: 2 }
      const b: VectorClockValue = { clientA: 3, clientB: 4, clientC: 1 }

      const result = mergeClocks(a, b)

      expect(result).toEqual({ clientA: 5, clientB: 4, clientC: 1 })
    })
  })

  describe("compareClocks", () => {
    it("compares two clocks", () => {
      const a: VectorClockValue = { clientA: 3 }
      const b: VectorClockValue = { clientA: 5 }

      expect(compareClocks(a, b)).toBe("before")
      expect(compareClocks(b, a)).toBe("after")
    })
  })

  describe("serializeClock / parseClock", () => {
    it("round-trips a clock", () => {
      const original: VectorClockValue = { clientA: 5, clientB: 3 }
      const serialized = serializeClock(original)
      const parsed = parseClock(serialized)

      expect(parsed).toEqual(original)
    })

    it("parseClock returns empty for invalid JSON", () => {
      expect(parseClock("invalid")).toEqual({})
    })
  })
})
