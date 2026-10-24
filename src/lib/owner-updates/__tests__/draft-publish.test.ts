import { describe, expect, it, vi } from "vitest"

import { persistOwnerUpdateDraft } from "@/lib/owner-updates/draft-publish"

type Version = {
  readonly revision: number
  readonly updatedAt: string
}

type SaveResult =
  | ({ readonly success: true } & Version)
  | { readonly success: false; readonly error: string }

describe("owner update draft publishing", () => {
  it("passes the saved version to publish", async () => {
    const sequence: string[] = []
    const save = vi.fn(async (): Promise<SaveResult> => {
      sequence.push("save")
      return {
        success: true,
        revision: 4,
        updatedAt: "2026-07-28T14:30:00.000Z",
      }
    })
    const publish = vi.fn(async (version: Version): Promise<SaveResult> => {
      sequence.push("publish")
      expect(version).toEqual({
        revision: 4,
        updatedAt: "2026-07-28T14:30:00.000Z",
      })
      return {
        success: true,
        revision: 5,
        updatedAt: "2026-07-28T14:31:00.000Z",
      }
    })

    const result = await persistOwnerUpdateDraft({
      intent: "publish",
      save,
      publish,
    })

    expect(result).toEqual({
      success: true,
      revision: 5,
      updatedAt: "2026-07-28T14:31:00.000Z",
    })
    expect(sequence).toEqual(["save", "publish"])
  })

  it("does not publish when saving fails", async () => {
    const save = vi.fn(async (): Promise<SaveResult> => ({
      success: false,
      error: "Unable to save the draft.",
    }))
    const publish = vi.fn(async (): Promise<SaveResult> => ({
      success: true,
      revision: 5,
      updatedAt: "2026-07-28T14:31:00.000Z",
    }))

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
    const save = vi.fn(async (): Promise<SaveResult> => ({
      success: true,
      revision: 4,
      updatedAt: "2026-07-28T14:30:00.000Z",
    }))
    const publish = vi.fn(async (): Promise<SaveResult> => ({
      success: true,
      revision: 5,
      updatedAt: "2026-07-28T14:31:00.000Z",
    }))

    const result = await persistOwnerUpdateDraft({
      intent: "save",
      save,
      publish,
    })

    expect(result).toEqual({
      success: true,
      revision: 4,
      updatedAt: "2026-07-28T14:30:00.000Z",
    })
    expect(publish).not.toHaveBeenCalled()
  })
})
