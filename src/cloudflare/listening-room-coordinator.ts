import { DurableObject } from "cloudflare:workers"
import {
  isListeningRoomConnectionMetadata,
  parseListeningRoomClientMessage,
  type ListeningRoomConnectionMetadata,
  type ListeningRoomServerMessage,
} from "../lib/listening-room-realtime"

const SEQUENCE_KEY = "sequence"

function connectionMetadata(
  request: Request
): ListeningRoomConnectionMetadata | null {
  const roomId = request.headers.get("X-Compass-Room-Id")
  const userId = request.headers.get("X-Compass-User-Id")
  if (!roomId || !userId) return null
  return { roomId, userId }
}

export class ListeningRoomCoordinator extends DurableObject<CloudflareEnv> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 })
    }
    const metadata = connectionMetadata(request)
    if (!metadata) return new Response("Unauthorized", { status: 401 })

    const pair = new WebSocketPair()
    const sockets = Object.values(pair)
    const client = sockets[0]
    const server = sockets[1]
    if (!client || !server) {
      return new Response("Unable to create WebSocket", { status: 500 })
    }

    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(metadata)
    const sequence = (await this.ctx.storage.get<number>(SEQUENCE_KEY)) ?? 0
    this.send(server, {
      type: "hello",
      sequence,
      serverTime: new Date().toISOString(),
    })
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== "string") return
    const metadata = socket.deserializeAttachment()
    if (!isListeningRoomConnectionMetadata(metadata)) {
      socket.close(1008, "Invalid connection")
      return
    }
    const parsed = parseListeningRoomClientMessage(message)
    if (!parsed) {
      socket.close(1008, "Invalid message")
      return
    }

    const current = (await this.ctx.storage.get<number>(SEQUENCE_KEY)) ?? 0
    const sequence = current + 1
    await this.ctx.storage.put(SEQUENCE_KEY, sequence)
    const event: ListeningRoomServerMessage = {
      type: "room_changed",
      sequence,
      serverTime: new Date().toISOString(),
    }
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === socket) continue
      const peerMetadata = peer.deserializeAttachment()
      if (
        isListeningRoomConnectionMetadata(peerMetadata) &&
        peerMetadata.roomId === metadata.roomId
      ) {
        this.send(peer, event)
      }
    }
  }

  webSocketClose(): void {
    // Close frames are acknowledged by the runtime at this compatibility date.
  }

  webSocketError(): void {
    // The browser reconnects; there is no per-connection state to clean up.
  }

  private send(socket: WebSocket, message: ListeningRoomServerMessage): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // A concurrent disconnect should not prevent delivery to other listeners.
    }
  }
}
