import { describe, expect, it } from "vitest"
import {
  isListeningRoomConnectionMetadata,
  parseListeningRoomClientMessage,
  parseListeningRoomServerMessage,
} from "@/lib/listening-room-realtime"

describe("listening room realtime protocol", () => {
  it("accepts the intentionally small client protocol", () => {
    expect(parseListeningRoomClientMessage('{"type":"room_changed"}')).toEqual({
      type: "room_changed",
    })
    expect(parseListeningRoomClientMessage('{"type":"play"}')).toBeNull()
    expect(parseListeningRoomClientMessage("not-json")).toBeNull()
  })

  it("validates server events", () => {
    expect(
      parseListeningRoomServerMessage(
        '{"type":"room_changed","sequence":4,"serverTime":"2026-09-03T12:00:00.000Z"}'
      )
    ).toEqual({
      type: "room_changed",
      sequence: 4,
      serverTime: "2026-09-03T12:00:00.000Z",
    })
    expect(
      parseListeningRoomServerMessage(
        '{"type":"room_changed","sequence":4.5,"serverTime":"now"}'
      )
    ).toBeNull()
  })

  it("validates hibernation-safe connection metadata", () => {
    expect(
      isListeningRoomConnectionMetadata({
        roomId: "room-1",
        userId: "user-1",
      })
    ).toBe(true)
    expect(isListeningRoomConnectionMetadata({ roomId: "room-1" })).toBe(false)
  })
})
