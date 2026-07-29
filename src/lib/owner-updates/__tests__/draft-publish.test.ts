import { describe, expect, it, vi } from "vitest"

import { persistOwnerUpdateDraft } from "@/lib/owner-updates/draft-publish"

describe("owner update draft publishing", () => {
  it("saves current edits before publishing", async () => {
    const sequence: string[] = []
    const save = vi.fn(async () => {
      sequence.push("save")
      return { success: true } as const
    })
    const publish = vi.fn(async () => {
      sequence.push("publish")
      return { success: true } as const
    })

    const result = await persistOwnerUpdateDraft({
      intent: "publish",
      save,
      publish,
    })

    expect(result).toEqual({ success: true })
    expect(sequence).toEqual(["save", "publish"])
  })

  it("does not publish when saving fails", async () => {
    const save = vi.fn(async () => ({
      success: false,
      error: "Unable to save the draft.",
    }) as const)
    const publish = vi.fn(async () => ({ success: true }) as const)

    const result = await persistOwnerUpdateDraft({
      intent: "publish",
      save,
      publish,
    })

    expect(result).toEqual({
      success: false,
      error: "Unable to save the draft.",
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it("does not publish for an ordinary save", async () => {
    const save = vi.fn(async () => ({ success: true }) as const)
    const publish = vi.fn(async () => ({ success: true }) as const)

    const result = await persistOwnerUpdateDraft({
      intent: "save",
      save,
      publish,
    })

    expect(result).toEqual({ success: true })
    expect(publish).not.toHaveBeenCalled()
  })
})
