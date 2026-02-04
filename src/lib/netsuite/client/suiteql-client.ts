import { getSuiteQLUrl } from "../config"
import { BaseClient } from "./base-client"
import type { SuiteQLResponse } from "./types"

const MAX_ROWS = 100000
const DEFAULT_PAGE_SIZE = 1000

export class SuiteQLClient {
  private client: BaseClient
  private accountId: string

  constructor(client: BaseClient, accountId: string) {
    this.client = client
    this.accountId = accountId
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    limit = DEFAULT_PAGE_SIZE,
    offset = 0
  ): Promise<SuiteQLResponse & { items: T[] }> {
    const url = this.buildUrl(limit, offset)

    return this.client.request(url, {
      method: "POST",
      headers: { Prefer: "transient" },
      body: JSON.stringify({ q: sql }),
    })
  }

  async queryAll<T extends Record<string, unknown>>(
    sql: string,
    pageSize = DEFAULT_PAGE_SIZE
  ): Promise<T[]> {
    const all: T[] = []
    let offset = 0

    while (offset < MAX_ROWS) {
      const response = await this.query<T>(sql, pageSize, offset)
      all.push(...response.items)

      if (!response.hasMore) break
      offset += pageSize
    }

    return all
  }

  // convenience: get a single value from a count/sum query
  async queryScalar<T>(sql: string): Promise<T | null> {
    const response = await this.query(sql, 1)
    if (response.items.length === 0) return null

    const row = response.items[0]
    const keys = Object.keys(row)
    if (keys.length === 0) return null

    return row[keys[0]] as T
  }

  private buildUrl(limit: number, offset: number): string {
    const base = getSuiteQLUrl(this.accountId)
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    return `${base}?${params.toString()}`
  }
}
