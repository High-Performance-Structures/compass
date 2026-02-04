import { TokenManager } from "../auth/token-manager"
import { NetSuiteError, classifyError } from "./errors"
import { ConcurrencyLimiter } from "../rate-limiter/concurrency-limiter"

interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
}

// circuit breaker: after N consecutive failures, pause requests
const CIRCUIT_BREAKER_THRESHOLD = 5
const CIRCUIT_BREAKER_RESET_MS = 60000

export class BaseClient {
  private tokenManager: TokenManager
  private limiter: ConcurrencyLimiter
  private retryConfig: RetryConfig
  private consecutiveFailures = 0
  private circuitOpenUntil = 0

  constructor(
    tokenManager: TokenManager,
    limiter: ConcurrencyLimiter,
    retryConfig?: Partial<RetryConfig>
  ) {
    this.tokenManager = tokenManager
    this.limiter = limiter
    this.retryConfig = { ...DEFAULT_RETRY, ...retryConfig }
  }

  async request<T>(
    url: string,
    init: RequestInit = {}
  ): Promise<T> {
    this.checkCircuitBreaker()

    return this.limiter.execute(() =>
      this.requestWithRetry<T>(url, init)
    )
  }

  private async requestWithRetry<T>(
    url: string,
    init: RequestInit,
    attempt = 0
  ): Promise<T> {
    try {
      const token = await this.tokenManager.getAccessToken()
      const headers = new Headers(init.headers)
      headers.set("Authorization", `Bearer ${token}`)
      headers.set("Content-Type", "application/json")
      headers.set("Accept", "application/json")

      const response = await fetch(url, { ...init, headers })

      if (response.ok) {
        this.consecutiveFailures = 0

        if (response.status === 204) return undefined as T

        return (await response.json()) as T
      }

      const body = await response.json().catch(
        () => response.text()
      )
      const classified = classifyError(response.status, body)
      const error = new NetSuiteError({
        ...classified,
        statusCode: response.status,
        raw: body,
      })

      if (error.retryable && attempt < this.retryConfig.maxRetries) {
        const delay = this.getBackoffDelay(attempt, error.retryAfter)
        await sleep(delay)
        return this.requestWithRetry<T>(url, init, attempt + 1)
      }

      this.recordFailure()
      throw error
    } catch (err) {
      if (err instanceof NetSuiteError) throw err

      // network errors
      if (attempt < this.retryConfig.maxRetries) {
        const delay = this.getBackoffDelay(attempt, null)
        await sleep(delay)
        return this.requestWithRetry<T>(url, init, attempt + 1)
      }

      this.recordFailure()
      throw new NetSuiteError({
        message: err instanceof Error
          ? err.message
          : "Network error",
        category: "network",
        raw: err,
      })
    }
  }

  private getBackoffDelay(
    attempt: number,
    retryAfter: number | null
  ): number {
    if (retryAfter) return retryAfter

    const delay = this.retryConfig.baseDelay * Math.pow(2, attempt)
    const jitter = Math.random() * 0.3 * delay
    return Math.min(delay + jitter, this.retryConfig.maxDelay)
  }

  private checkCircuitBreaker(): void {
    if (Date.now() < this.circuitOpenUntil) {
      throw new NetSuiteError({
        message: "Circuit breaker open - too many consecutive failures",
        category: "server_error",
      })
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS
      this.consecutiveFailures = 0
    }
  }

  resetCircuitBreaker(): void {
    this.consecutiveFailures = 0
    this.circuitOpenUntil = 0
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
