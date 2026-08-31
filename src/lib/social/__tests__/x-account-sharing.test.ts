import { describe, expect, it } from "vitest"

import {
  freshestXAccessAccount,
  newestXRefreshAccount,
  sharedXDepartments,
  type XCredentialAccount,
} from "@/lib/social/x-account-sharing"

function account(input: {
  readonly department: string
  readonly externalAccountId?: string
  readonly tokenExpiresAt: string
  readonly updatedAt: string
  readonly refreshTokenEncrypted?: string | null
  readonly status?: string
}): XCredentialAccount {
  return {
    department: input.department,
    externalAccountId: input.externalAccountId ?? "orc-account",
    accessTokenEncrypted: `${input.department}-access-token`,
    refreshTokenEncrypted: input.refreshTokenEncrypted ?? `${input.department}-refresh-token`,
    tokenExpiresAt: input.tokenExpiresAt,
    grantedScopes: "offline.access tweet.write",
    status: input.status ?? "connected",
    updatedAt: input.updatedAt,
  }
}

describe("shared X account credentials", () => {
  const now = new Date("2026-08-31T06:20:00.000Z").getTime()
  const accounts = [
    account({
      department: "O",
      tokenExpiresAt: "2026-08-31T03:37:36.031Z",
      updatedAt: "2026-08-31T06:12:32.267Z",
    }),
    account({
      department: "D",
      tokenExpiresAt: "2026-08-31T08:09:57.332Z",
      updatedAt: "2026-08-31T06:09:57.332Z",
    }),
    account({
      department: "H",
      externalAccountId: "hps-account",
      tokenExpiresAt: "2026-08-31T08:00:00.000Z",
      updatedAt: "2026-08-31T06:00:00.000Z",
    }),
  ]

  it("shares a reconnect with departments using the same X profile", () => {
    expect(sharedXDepartments({
      requestedDepartment: "D",
      externalAccountId: "orc-account",
      accounts,
    })).toEqual(["D", "O"])
  })

  it("does not silently reconnect a department that was disconnected", () => {
    expect(sharedXDepartments({
      requestedDepartment: "D",
      externalAccountId: "orc-account",
      accounts: accounts.map((candidate) => candidate.department === "O"
        ? { ...candidate, status: "disconnected" }
        : candidate),
    })).toEqual(["D"])
  })

  it("reuses a fresh sibling access token instead of refreshing a stale token", () => {
    expect(freshestXAccessAccount(
      accounts.filter((candidate) => candidate.externalAccountId === "orc-account"),
      now,
    )?.department).toBe("D")
  })

  it("chooses the newest rotating refresh token when every access token is expired", () => {
    expect(newestXRefreshAccount(accounts)?.department).toBe("D")
  })
})
