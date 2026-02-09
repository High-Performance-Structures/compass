// WebSocket server -- Bun.serve native WS

import { timingSafeEqual } from "crypto"
import type { ServerWebSocket } from "bun"
import type { BridgeConfig } from "./config"
import type { RegisterResult } from "./auth"
import { handleChatRequest } from "./inference"
import { setCompassTools } from "./tools/registry"

interface WsData {
  authenticated: boolean
  abortControllers: Map<string, AbortController>
}

export function startServer(
  config: BridgeConfig,
  registration: RegisterResult,
): void {
  // register compass tools from registration
  setCompassTools(registration.tools.map((t) => t.name))

  const server = Bun.serve<WsData>({
    hostname: "127.0.0.1",
    port: config.port,

    fetch(req, server) {
      const url = new URL(req.url)

      // health check endpoint
      if (url.pathname === "/health") {
        return new Response("ok")
      }

      // upgrade to WebSocket
      const upgraded = server.upgrade(req, {
        data: {
          authenticated: false,
          abortControllers: new Map(),
        },
      })

      if (!upgraded) {
        return new Response("upgrade failed", {
          status: 400,
        })
      }

      return undefined as unknown as Response
    },

    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        console.log("[bridge] client connected")
        // auto-authenticate -- daemon is localhost-only
        // and already authenticated with Compass at startup
        ws.data.authenticated = true
        ws.send(
          JSON.stringify({
            type: "auth_ok",
            user: {
              id: registration.user.id,
              name: registration.user.name,
              role: registration.user.role,
            },
          }),
        )
      },

      message(
        ws: ServerWebSocket<WsData>,
        raw: string | Buffer,
      ) {
        const text =
          typeof raw === "string"
            ? raw
            : raw.toString()

        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(text)
        } catch {
          ws.send(
            JSON.stringify({
              type: "auth_error",
              message: "invalid JSON",
            }),
          )
          return
        }

        const type = msg.type as string

        // heartbeat
        if (type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }))
          return
        }

        // auth handshake
        if (type === "auth") {
          const apiKey =
            typeof msg.apiKey === "string"
              ? msg.apiKey
              : ""
          const a = Buffer.from(apiKey)
          const b = Buffer.from(config.apiKey)
          const keysMatch =
            a.length === b.length &&
            timingSafeEqual(a, b)
          if (keysMatch) {
            ws.data.authenticated = true
            ws.send(
              JSON.stringify({
                type: "auth_ok",
                user: {
                  id: registration.user.id,
                  name: registration.user.name,
                  role: registration.user.role,
                },
              }),
            )
          } else {
            ws.send(
              JSON.stringify({
                type: "auth_error",
                message: "invalid API key",
              }),
            )
          }
          return
        }

        // require auth for everything else
        if (!ws.data.authenticated) {
          ws.send(
            JSON.stringify({
              type: "auth_error",
              message: "not authenticated",
            }),
          )
          return
        }

        // chat message
        if (type === "chat.send") {
          const id = msg.id as string
          const runId = crypto.randomUUID()

          // ack immediately
          ws.send(
            JSON.stringify({
              type: "chat.ack",
              id,
              runId,
            }),
          )

          const abortController = new AbortController()
          ws.data.abortControllers.set(
            runId,
            abortController,
          )

          const context = msg.context as {
            currentPage: string
            timezone: string
            conversationId: string
          }

          const messages =
            msg.messages as ReadonlyArray<{
              role: string
              parts?: ReadonlyArray<{
                type: string
                text?: string
              }>
            }>

          const model =
            typeof msg.model === "string"
              ? msg.model
              : undefined

          handleChatRequest(
            config,
            registration,
            {
              messages,
              context,
              model,
              runId,
            },
            (data: string) => ws.send(data),
            abortController.signal,
          ).catch((err) => {
            const errMsg =
              err instanceof Error
                ? err.message
                : "inference error"
            ws.send(
              JSON.stringify({
                type: "chat.error",
                runId,
                error: errMsg,
              }),
            )
          }).finally(() => {
            ws.data.abortControllers.delete(runId)
          })

          return
        }

        // abort
        if (type === "chat.abort") {
          const runId = msg.runId as string
          const controller =
            ws.data.abortControllers.get(runId)
          if (controller) {
            controller.abort()
            ws.data.abortControllers.delete(runId)
          }
          return
        }
      },

      close(ws: ServerWebSocket<WsData>) {
        console.log("[bridge] client disconnected")
        // abort all active runs
        for (const [, controller] of ws.data
          .abortControllers) {
          controller.abort()
        }
        ws.data.abortControllers.clear()
      },
    },
  })

  console.log(
    `[bridge] listening on ws://127.0.0.1:${server.port}`,
  )
  console.log(
    `[bridge] connected as ${registration.user.name} ` +
      `(${registration.user.role})`,
  )
  console.log(
    `[bridge] ${registration.tools.length} compass tools available`,
  )
}
