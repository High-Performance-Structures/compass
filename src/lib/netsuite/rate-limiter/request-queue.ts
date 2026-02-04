// priority-based FIFO request queue.
// wraps the concurrency limiter with named priorities
// so sync operations can be deprioritized vs user-triggered actions.

import { ConcurrencyLimiter } from "./concurrency-limiter"

export type RequestPriority = "critical" | "high" | "normal" | "low"

const PRIORITY_VALUES: Record<RequestPriority, number> = {
  critical: 30,
  high: 20,
  normal: 10,
  low: 0,
}

export class RequestQueue {
  private limiter: ConcurrencyLimiter

  constructor(limiter: ConcurrencyLimiter) {
    this.limiter = limiter
  }

  async enqueue<T>(
    fn: () => Promise<T>,
    priority: RequestPriority = "normal"
  ): Promise<T> {
    return this.limiter.execute(fn, PRIORITY_VALUES[priority])
  }

  get stats() {
    return {
      running: this.limiter.currentConcurrency,
      maxAllowed: this.limiter.maxAllowed,
      queued: this.limiter.queueLength,
    }
  }
}
