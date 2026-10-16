import { describe, expect, it } from "vitest"

import {
  isOwnerUpdateEditorLocked,
  isOwnerUpdateReconciled,
} from "@/lib/owner-updates/editor-state"

describe("owner update editor request state", () => {
  it("keeps every editor control locked until the saved version is reconciled", () => {
    expect(isOwnerUpdateEditorLocked("saving")).toBe(true)
    expect(isOwnerUpdateEditorLocked("reconciling")).toBe(true)
    expect(isOwnerUpdateEditorLocked("idle")).toBe(false)
    expect(isOwnerUpdateEditorLocked("saved")).toBe(false)
    expect(isOwnerUpdateEditorLocked("error")).toBe(false)
  })

  it("does not treat a delayed refresh as authoritative until both version values match", () => {
    const savedVersion = {
      revision: 8,
      updatedAt: "2026-10-16T12:00:01.000Z",
    }

    expect(
      isOwnerUpdateReconciled(savedVersion, {
        revision: 7,
        updatedAt: "2026-10-16T12:00:00.000Z",
      })
    ).toBe(false)
    expect(
      isOwnerUpdateReconciled(savedVersion, {
        revision: 8,
        updatedAt: "2026-10-16T12:00:01.000Z",
      })
    ).toBe(true)
  })
})
