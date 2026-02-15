// Vector clock implementation for distributed sync
// Detects concurrent modifications and establishes causal ordering

export type VectorClockValue = Record<string, number>

export class VectorClock {
  private clock: VectorClockValue

  constructor(initial?: VectorClockValue) {
    this.clock = initial ? { ...initial } : {}
  }

  // Get the current tick for a client
  get(clientId: string): number {
    return this.clock[clientId] ?? 0
  }

  // Increment the clock for a client (called on local mutation)
  increment(clientId: string): VectorClockValue {
    this.clock[clientId] = (this.clock[clientId] ?? 0) + 1
    return this.toJSON()
  }

  // Set a specific value (used when receiving remote updates)
  set(clientId: string, value: number): void {
    this.clock[clientId] = value
  }

  // Merge with another vector clock (takes max of each component)
  // Returns true if this clock changed as a result
  merge(other: VectorClockValue): boolean {
    let changed = false
    for (const [clientId, tick] of Object.entries(other)) {
      if ((this.clock[clientId] ?? 0) < tick) {
        this.clock[clientId] = tick
        changed = true
      }
    }
    return changed
  }

  // Compare two vector clocks
  // Returns: "before" | "after" | "concurrent" | "equal"
  compare(other: VectorClockValue): ComparisonResult {
    const otherClock = new VectorClock(other)
    let thisLess = false
    let otherLess = false

    // Collect all client IDs from both clocks
    const allClients = new Set([
      ...Object.keys(this.clock),
      ...Object.keys(other),
    ])

    for (const clientId of allClients) {
      const thisVal = this.get(clientId)
      const otherVal = otherClock.get(clientId)

      if (thisVal < otherVal) thisLess = true
      if (otherVal < thisVal) otherLess = true
    }

    if (!thisLess && !otherLess) return "equal"
    if (thisLess && !otherLess) return "before"
    if (otherLess && !thisLess) return "after"
    return "concurrent"
  }

  // Check if this clock happened before another (strict ordering)
  happenedBefore(other: VectorClockValue): boolean {
    return this.compare(other) === "before"
  }

  // Check if clocks are concurrent (neither happened before the other)
  isConcurrentWith(other: VectorClockValue): boolean {
    return this.compare(other) === "concurrent"
  }

  // Serialize to JSON for storage
  toJSON(): VectorClockValue {
    return { ...this.clock }
  }

  // Serialize to string for database storage
  toString(): string {
    return JSON.stringify(this.clock)
  }

  // Parse from string
  static fromString(json: string): VectorClock {
    try {
      const parsed = JSON.parse(json) as VectorClockValue
      return new VectorClock(parsed)
    } catch {
      return new VectorClock()
    }
  }

  // Get all client IDs
  getClientIds(): string[] {
    return Object.keys(this.clock)
  }

  // Get a copy of the raw clock object
  toObject(): VectorClockValue {
    return { ...this.clock }
  }

  // Check if clock is empty
  isEmpty(): boolean {
    return Object.keys(this.clock).length === 0
  }
}

export type ComparisonResult = "before" | "after" | "concurrent" | "equal"

// Utility functions

// Create a new vector clock with one increment
export function createVectorClock(clientId: string): VectorClockValue {
  const clock = new VectorClock()
  clock.increment(clientId)
  return clock.toJSON()
}

// Increment an existing clock and return new value
export function incrementClock(
  clock: VectorClockValue,
  clientId: string
): VectorClockValue {
  const vc = new VectorClock(clock)
  return vc.increment(clientId)
}

// Merge two clocks
export function mergeClocks(
  a: VectorClockValue,
  b: VectorClockValue
): VectorClockValue {
  const vc = new VectorClock(a)
  vc.merge(b)
  return vc.toJSON()
}

// Compare two clocks
export function compareClocks(
  a: VectorClockValue,
  b: VectorClockValue
): ComparisonResult {
  const vc = new VectorClock(a)
  return vc.compare(b)
}

// Serialize clock to string
export function serializeClock(clock: VectorClockValue): string {
  return JSON.stringify(clock)
}

// Parse clock from string
export function parseClock(json: string): VectorClockValue {
  try {
    return JSON.parse(json) as VectorClockValue
  } catch {
    return {}
  }
}
