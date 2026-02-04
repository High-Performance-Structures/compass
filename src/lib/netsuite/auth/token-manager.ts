import { eq } from "drizzle-orm"
import type { NetSuiteConfig } from "../config"
import { encrypt, decrypt } from "./crypto"
import {
  refreshAccessToken,
  type OAuthTokens,
} from "./oauth-client"
import { netsuiteAuth } from "@/db/schema-netsuite"
import type { DrizzleD1Database } from "drizzle-orm/d1"

// refresh at 80% of token lifetime to avoid edge-case expiry
const REFRESH_THRESHOLD = 0.8

export class TokenManager {
  private config: NetSuiteConfig
  private db: DrizzleD1Database
  private cachedTokens: OAuthTokens | null = null

  constructor(config: NetSuiteConfig, db: DrizzleD1Database) {
    this.config = config
    this.db = db
  }

  async getAccessToken(): Promise<string> {
    const tokens = await this.loadTokens()
    if (!tokens) {
      throw new Error(
        "No NetSuite tokens found. Complete OAuth setup first."
      )
    }

    if (this.shouldRefresh(tokens)) {
      const refreshed = await this.refresh(tokens.refreshToken)
      return refreshed.accessToken
    }

    return tokens.accessToken
  }

  async storeTokens(tokens: OAuthTokens): Promise<void> {
    const encryptedAccess = await encrypt(
      tokens.accessToken,
      this.config.tokenEncryptionKey
    )
    const encryptedRefresh = await encrypt(
      tokens.refreshToken,
      this.config.tokenEncryptionKey
    )

    const existing = await this.db
      .select()
      .from(netsuiteAuth)
      .where(eq(netsuiteAuth.accountId, this.config.accountId))
      .limit(1)

    const now = new Date().toISOString()
    const values = {
      accountId: this.config.accountId,
      accessTokenEncrypted: encryptedAccess,
      refreshTokenEncrypted: encryptedRefresh,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
      issuedAt: tokens.issuedAt,
      updatedAt: now,
    }

    if (existing.length > 0) {
      await this.db
        .update(netsuiteAuth)
        .set(values)
        .where(eq(netsuiteAuth.accountId, this.config.accountId))
    } else {
      await this.db.insert(netsuiteAuth).values({
        id: crypto.randomUUID(),
        ...values,
        createdAt: now,
      })
    }

    this.cachedTokens = tokens
  }

  async hasTokens(): Promise<boolean> {
    const row = await this.db
      .select({ id: netsuiteAuth.id })
      .from(netsuiteAuth)
      .where(eq(netsuiteAuth.accountId, this.config.accountId))
      .limit(1)
    return row.length > 0
  }

  async clearTokens(): Promise<void> {
    await this.db
      .delete(netsuiteAuth)
      .where(eq(netsuiteAuth.accountId, this.config.accountId))
    this.cachedTokens = null
  }

  private shouldRefresh(tokens: OAuthTokens): boolean {
    const elapsed = Date.now() - tokens.issuedAt
    const threshold = tokens.expiresIn * 1000 * REFRESH_THRESHOLD
    return elapsed >= threshold
  }

  private async refresh(
    refreshToken: string
  ): Promise<OAuthTokens> {
    const tokens = await refreshAccessToken(
      this.config,
      refreshToken
    )
    await this.storeTokens(tokens)
    return tokens
  }

  private async loadTokens(): Promise<OAuthTokens | null> {
    if (this.cachedTokens) return this.cachedTokens

    const rows = await this.db
      .select()
      .from(netsuiteAuth)
      .where(eq(netsuiteAuth.accountId, this.config.accountId))
      .limit(1)

    if (rows.length === 0) return null

    const row = rows[0]

    const accessToken = await decrypt(
      row.accessTokenEncrypted,
      this.config.tokenEncryptionKey
    )
    const refreshToken = await decrypt(
      row.refreshTokenEncrypted,
      this.config.tokenEncryptionKey
    )

    this.cachedTokens = {
      accessToken,
      refreshToken,
      expiresIn: row.expiresIn,
      tokenType: row.tokenType,
      issuedAt: row.issuedAt,
    }

    return this.cachedTokens
  }
}
