import { getRecordUrl } from "../config"
import { BaseClient } from "./base-client"
import type {
  NetSuiteListResponse,
  NetSuiteRecord,
  NetSuiteRequestOptions,
} from "./types"

export class RecordClient {
  private client: BaseClient
  private accountId: string

  constructor(client: BaseClient, accountId: string) {
    this.client = client
    this.accountId = accountId
  }

  async get<T extends NetSuiteRecord>(
    recordType: string,
    id: string,
    options?: NetSuiteRequestOptions
  ): Promise<T> {
    const url = this.buildUrl(recordType, id, options)
    return this.client.request<T>(url)
  }

  async list<T extends NetSuiteRecord>(
    recordType: string,
    options?: NetSuiteRequestOptions
  ): Promise<NetSuiteListResponse<T>> {
    const url = this.buildUrl(recordType, undefined, options)
    return this.client.request<NetSuiteListResponse<T>>(url)
  }

  async listAll<T extends NetSuiteRecord>(
    recordType: string,
    options?: NetSuiteRequestOptions
  ): Promise<T[]> {
    const all: T[] = []
    let offset = 0
    const limit = options?.limit ?? 1000

    while (true) {
      const response = await this.list<T>(recordType, {
        ...options,
        limit,
        offset,
      })
      all.push(...response.items)

      if (!response.hasMore) break
      offset += limit
    }

    return all
  }

  async create(
    recordType: string,
    data: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<{ id: string }> {
    const url = getRecordUrl(this.accountId, recordType)
    const headers: Record<string, string> = {}
    if (idempotencyKey) {
      headers["X-NetSuite-Idempotency-Key"] = idempotencyKey
    }

    return this.client.request(url, {
      method: "POST",
      body: JSON.stringify(data),
      headers,
    })
  }

  async update(
    recordType: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const url = getRecordUrl(this.accountId, recordType, id)
    await this.client.request(url, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }

  async remove(
    recordType: string,
    id: string
  ): Promise<void> {
    const url = getRecordUrl(this.accountId, recordType, id)
    await this.client.request(url, { method: "DELETE" })
  }

  // netsuite record transformations (e.g. sales order -> invoice)
  async transform(
    sourceType: string,
    sourceId: string,
    targetType: string,
    data?: Record<string, unknown>
  ): Promise<{ id: string }> {
    const url = `${getRecordUrl(this.accountId, sourceType, sourceId)}/!transform/${targetType}`
    return this.client.request(url, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  private buildUrl(
    recordType: string,
    id?: string,
    options?: NetSuiteRequestOptions
  ): string {
    const base = getRecordUrl(this.accountId, recordType, id)
    const params = new URLSearchParams()

    if (options?.fields?.length) {
      params.set("fields", options.fields.join(","))
    }
    if (options?.query) {
      params.set("q", options.query)
    }
    if (options?.limit) {
      params.set("limit", String(options.limit))
    }
    if (options?.offset) {
      params.set("offset", String(options.offset))
    }
    if (options?.expandSubResources) {
      params.set("expandSubResources", "true")
    }

    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }
}
