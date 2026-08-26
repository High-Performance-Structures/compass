import { describe, expect, it } from "vitest"

import {
  createCherishPulseOutboxItem,
  enqueueFieldOutboxItem,
  listFieldOutboxItems,
  removeFieldOutboxItem,
  type FieldOutboxCherishPulse,
  type FieldOutboxStorage,
} from "@/lib/field/offline-outbox"

class MemoryStorage implements FieldOutboxStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  firstValue(): string | null {
    return this.values.values().next().value ?? null
  }
}

function jarvisItem(id: string): {
  readonly id: string
  readonly kind: "jarvis_prompt"
  readonly text: string
  readonly createdAt: string
} {
  return {
    id,
    kind: "jarvis_prompt",
    text: `Prompt ${id}`,
    createdAt: new Date().toISOString(),
  }
}

describe("field offline outbox", () => {
  it("keeps pending work isolated by organization and user scope", () => {
    const storage = new MemoryStorage()
    const firstItem = jarvisItem("one")
    const secondItem = jarvisItem("two")

    expect(
      enqueueFieldOutboxItem("org-a:user-a", firstItem, storage),
    ).toBe(true)
    expect(
      enqueueFieldOutboxItem("org-a:user-b", secondItem, storage),
    ).toBe(true)

    expect(listFieldOutboxItems("org-a:user-a", storage)).toEqual([firstItem])
    expect(listFieldOutboxItems("org-a:user-b", storage)).toEqual([secondItem])
    expect(listFieldOutboxItems("org-b:user-a", storage)).toEqual([])
  })

  it("stores CHERISH inputs needed for an authenticated replay", () => {
    const storage = new MemoryStorage()
    const item: FieldOutboxCherishPulse = {
      id: "pulse-1",
      kind: "cherish_pulse",
      cherishValue: "Integrity",
      responseType: "concern",
      message: "Please review this privately.",
      anonymous: true,
      createdAt: new Date().toISOString(),
    }

    expect(enqueueFieldOutboxItem("org:user", item, storage)).toBe(true)
    expect(listFieldOutboxItems("org:user", storage)).toEqual([item])

    removeFieldOutboxItem("org:user", item.id, storage)
    expect(listFieldOutboxItems("org:user", storage)).toEqual([])
  })

  it("preserves a client submission id across an online retry", () => {
    const id = "51da9e0f-a85e-4ad3-81ef-3881062413bc"
    const item = createCherishPulseOutboxItem({
      id,
      cherishValue: "Integrity",
      responseType: "concern",
      message: "Please review this privately.",
      anonymous: true,
    })

    expect(item.id).toBe(id)
    expect(item.anonymous).toBe(true)
  })

  it("rejects malformed items and recovers from corrupt storage", () => {
    const storage = new MemoryStorage()
    storage.setItem(
      "compass_field_outbox_v1:org%3Auser",
      "{not-valid-json",
    )

    expect(listFieldOutboxItems("org:user", storage)).toEqual([])
    expect(
      enqueueFieldOutboxItem(
        "org:user",
        {
          ...jarvisItem("empty"),
          text: "",
        },
        storage,
      ),
    ).toBe(false)
  })

  it("caps device storage to the newest fifty items", () => {
    const storage = new MemoryStorage()
    for (let index = 0; index < 55; index += 1) {
      enqueueFieldOutboxItem(
        "org:user",
        jarvisItem(String(index).padStart(2, "0")),
        storage,
      )
    }

    const items = listFieldOutboxItems("org:user", storage)
    expect(items).toHaveLength(50)
    expect(items[0]?.id).toBe("05")
    expect(items[49]?.id).toBe("54")
    expect(storage.firstValue()).not.toBeNull()
  })
})
