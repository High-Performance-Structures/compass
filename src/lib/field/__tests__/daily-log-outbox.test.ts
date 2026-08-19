import { describe, expect, it, vi } from "vitest"

import { drainDailyLogOutbox } from "@/lib/field/daily-log-outbox"
import type { FieldOutboxItem } from "@/lib/field/types"

function dailyLogItem(): FieldOutboxItem {
  return {
    id: "9a714b2f-aead-4da0-8580-2545d5f5426e",
    kind: "daily_log",
    projectId: "kiowa",
    createdAt: "2026-08-18T23:00:00.000Z",
    payload: {
      logDate: "2026-08-18",
      workCompleted: "Framing progress",
      issues: "",
      crewPresent: "Dan",
      notes: "",
    },
    remoteDailyLogId: null,
    attachments: [
      {
        id: "photo-1",
        localPath: "field/photo-1.jpg",
        fileName: "photo-1.jpg",
        mimeType: "image/jpeg",
        fileSize: 10,
        capturedAt: "2026-08-18T23:00:00.000Z",
      },
      {
        id: "photo-2",
        localPath: "field/photo-2.jpg",
        fileName: "photo-2.jpg",
        mimeType: "image/jpeg",
        fileSize: 20,
        capturedAt: "2026-08-18T23:01:00.000Z",
      },
    ],
  }
}

describe("drainDailyLogOutbox", () => {
  it("checkpoints creation and attachments before removing the log", async () => {
    const snapshots: FieldOutboxItem[][] = []
    const createDailyLog = vi.fn().mockResolvedValue("remote-log")
    const uploadAttachment = vi.fn().mockResolvedValue(undefined)

    const syncedCount = await drainDailyLogOutbox([dailyLogItem()], {
      createDailyLog,
      uploadAttachment,
      persist: async (items) => {
        snapshots.push([...items])
      },
    })

    expect(syncedCount).toBe(1)
    expect(createDailyLog).toHaveBeenCalledTimes(1)
    expect(uploadAttachment).toHaveBeenCalledTimes(2)
    expect(snapshots[0]?.[0]).toMatchObject({ remoteDailyLogId: "remote-log" })
    expect(snapshots[1]?.[0]).toMatchObject({ attachments: [{ id: "photo-2" }] })
    expect(snapshots.at(-1)).toEqual([])
  })

  it("keeps the remote ID when an attachment must retry", async () => {
    const snapshots: FieldOutboxItem[][] = []

    await expect(
      drainDailyLogOutbox([dailyLogItem()], {
        createDailyLog: vi.fn().mockResolvedValue("remote-log"),
        uploadAttachment: vi.fn().mockRejectedValue(new Error("offline")),
        persist: async (items) => {
          snapshots.push([...items])
        },
      })
    ).rejects.toThrow("offline")

    expect(snapshots.at(-1)?.[0]).toMatchObject({
      remoteDailyLogId: "remote-log",
      attachments: [{ id: "photo-1" }, { id: "photo-2" }],
    })
  })
})
