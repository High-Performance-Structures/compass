// semaphore-based concurrency limiter.
// netsuite shares a pool of 15 concurrent requests across
// ALL integrations (SOAP + REST + RESTlet). we default to
// a conservative limit and back off adaptively on 429s.

export class ConcurrencyLimiter {
  private maxConcurrent: number
  private running = 0
  private queue: Array<{
    resolve: () => void
    priority: number
  }> = []

  constructor(maxConcurrent = 15) {
    this.maxConcurrent = maxConcurrent
  }

  async execute<T>(
    fn: () => Promise<T>,
    priority = 0
  ): Promise<T> {
    await this.acquire(priority)
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(priority: number): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++
      return Promise.resolve()
    }

    return new Promise(resolve => {
      this.queue.push({ resolve, priority })
      this.queue.sort((a, b) => b.priority - a.priority)
    })
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      next.resolve()
    } else {
      this.running--
    }
  }

  // adaptively reduce concurrency when we hit rate limits
  reduceConcurrency(): void {
    if (this.maxConcurrent > 1) {
      this.maxConcurrent = Math.max(
        1,
        Math.floor(this.maxConcurrent * 0.7)
      )
    }
  }

  // gradually restore concurrency after successful requests
  restoreConcurrency(original: number): void {
    if (this.maxConcurrent < original) {
      this.maxConcurrent = Math.min(
        original,
        this.maxConcurrent + 1
      )
    }
  }

  get currentConcurrency(): number {
    return this.running
  }

  get maxAllowed(): number {
    return this.maxConcurrent
  }

  get queueLength(): number {
    return this.queue.length
  }
}
