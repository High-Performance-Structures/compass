import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateApiKey, hashApiKey, validateApiKey } from "../auth"

describe("generateApiKey", () => {
  it("produces a key with ck_ prefix", () => {
    const { key } = generateApiKey()
    expect(key.startsWith("ck_")).toBe(true)
  })

  it("produces a key of 43 characters (3 prefix + 40 hex)", () => {
    const { key } = generateApiKey()
    expect(key.length).toBe(43)
  })

  it("returns a keyPrefix of first 8 chars", () => {
    const { key, keyPrefix } = generateApiKey()
    expect(keyPrefix).toBe(key.slice(0, 8))
    expect(keyPrefix.length).toBe(8)
  })

  it("generates unique keys each call", () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.key).not.toBe(b.key)
  })

  it("key body is valid hex", () => {
    const { key } = generateApiKey()
    const hex = key.slice(3) // strip ck_
    expect(hex).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe("hashApiKey", () => {
  it("returns a 64-char hex string (SHA-256)", async () => {
    const hash = await hashApiKey("ck_test1234")
    expect(hash.length).toBe(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("returns consistent output for the same input", async () => {
    const a = await hashApiKey("ck_abc123")
    const b = await hashApiKey("ck_abc123")
    expect(a).toBe(b)
  })

  it("returns different output for different inputs", async () => {
    const a = await hashApiKey("ck_key_one")
    const b = await hashApiKey("ck_key_two")
    expect(a).not.toBe(b)
  })
})

describe("validateApiKey", () => {
  function createMockDb(row: Record<string, unknown> | undefined) {
    const chainMock = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue(row),
    }

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue(undefined),
    }

    return {
      select: vi.fn().mockReturnValue(chainMock),
      update: vi.fn().mockReturnValue(updateChain),
      _chainMock: chainMock,
      _updateChain: updateChain,
    } as unknown as Parameters<typeof validateApiKey>[0]
  }

  it("returns invalid for a key not found in DB", async () => {
    const db = createMockDb(undefined)
    const result = await validateApiKey(db, "ck_nonexistent")
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toBe("Invalid API key")
    }
  })

  it("returns valid for an active, non-expired key", async () => {
    const db = createMockDb({
      id: "key-1",
      userId: "user-1",
      scopes: '["read","write"]',
      isActive: true,
      expiresAt: null,
    })

    const result = await validateApiKey(db, "ck_validkey")
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.userId).toBe("user-1")
      expect(result.scopes).toEqual(["read", "write"])
      expect(result.keyId).toBe("key-1")
    }
  })

  it("returns expired for an expired key", async () => {
    const pastDate = new Date(
      Date.now() - 86400000
    ).toISOString()

    const db = createMockDb({
      id: "key-2",
      userId: "user-2",
      scopes: '["read"]',
      isActive: true,
      expiresAt: pastDate,
    })

    const result = await validateApiKey(db, "ck_expiredkey")
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toBe("API key expired")
    }
  })

  it("returns valid for a key with future expiry", async () => {
    const futureDate = new Date(
      Date.now() + 86400000
    ).toISOString()

    const db = createMockDb({
      id: "key-3",
      userId: "user-3",
      scopes: '["admin"]',
      isActive: true,
      expiresAt: futureDate,
    })

    const result = await validateApiKey(db, "ck_futurekey")
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.userId).toBe("user-3")
      expect(result.scopes).toEqual(["admin"])
    }
  })

  it("fires a last-used-at update on valid key", async () => {
    const db = createMockDb({
      id: "key-4",
      userId: "user-4",
      scopes: '["read"]',
      isActive: true,
      expiresAt: null,
    })

    await validateApiKey(db, "ck_trackusage")

    const mockDb = db as unknown as {
      update: ReturnType<typeof vi.fn>
    }
    expect(mockDb.update).toHaveBeenCalled()
  })
})
