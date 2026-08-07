import { describe, expect, it } from "vitest"

import { accountKeysFromScimIdentity } from "@/lib/goto/account-discovery"

describe("accountKeysFromScimIdentity", () => {
  it("reads the account keys from the SCIM accounts array", () => {
    expect(
      accountKeysFromScimIdentity({
        accounts: [
          { key: "account-1", name: "Primary" },
          { accountKey: "account-2", name: "Secondary" },
        ],
      })
    ).toEqual(["account-1", "account-2"])
  })

  it("reads an accounts array nested inside a SCIM extension", () => {
    expect(
      accountKeysFromScimIdentity({
        id: "user-key",
        "urn:ietf:params:scim:schemas:extension:goto:2.0:User": {
          accounts: [{ account_key: 31416 }],
        },
      })
    ).toEqual(["31416"])
  })

  it("supports GoTo account arrays containing identifiers directly", () => {
    expect(
      accountKeysFromScimIdentity({
        Accounts: ["account-1", 31416, { id: "account-2" }],
      })
    ).toEqual(["account-1", "31416", "account-2"])
  })

  it("does not confuse the SCIM user id for an account key", () => {
    expect(accountKeysFromScimIdentity({ id: "user-key" })).toEqual([])
  })
})
