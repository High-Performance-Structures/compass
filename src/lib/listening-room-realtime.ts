export type ListeningRoomConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"

export type ListeningRoomConnectionMetadata = {
  readonly roomId: string
  readonly userId: string
}

export type ListeningRoomClientMessage = {
  readonly type: "room_changed"
}

export type ListeningRoomServerMessage =
  | {
      readonly type: "hello"
      readonly sequence: number
      readonly serverTime: string
    }
  | {
      readonly type: "room_changed"
      readonly sequence: number
      readonly serverTime: string
    }

function record(value: unknown): object | null {
  return typeof value === "object" && value !== null ? value : null
}

export function parseListeningRoomClientMessage(
  value: string
): ListeningRoomClientMessage | null {
  if (value.length > 1_024) return null
  try {
    const parsed = record(JSON.parse(value))
    return parsed && Reflect.get(parsed, "type") === "room_changed"
      ? { type: "room_changed" }
      : null
  } catch {
    return null
  }
}

export function parseListeningRoomServerMessage(
  value: string
): ListeningRoomServerMessage | null {
  if (value.length > 4_096) return null
  try {
    const parsed = record(JSON.parse(value))
    const type = parsed ? Reflect.get(parsed, "type") : null
    const sequence = parsed ? Reflect.get(parsed, "sequence") : null
    const serverTime = parsed ? Reflect.get(parsed, "serverTime") : null
    if (
      (type !== "hello" && type !== "room_changed") ||
      typeof sequence !== "number" ||
      !Number.isSafeInteger(sequence) ||
      typeof serverTime !== "string"
    ) {
      return null
    }
    return {
      type,
      sequence,
      serverTime,
    }
  } catch {
    return null
  }
}

export function isListeningRoomConnectionMetadata(
  value: unknown
): value is ListeningRoomConnectionMetadata {
  const candidate = record(value)
  if (!candidate) return false
  return (
    typeof Reflect.get(candidate, "roomId") === "string" &&
    typeof Reflect.get(candidate, "userId") === "string"
  )
}
