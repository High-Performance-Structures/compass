import type { SSEData } from "./types"

export function sseEncode(data: SSEData): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

export function createSSEStream(
  generator: AsyncGenerator<SSEData>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of generator) {
          controller.enqueue(encoder.encode(sseEncode(event)))
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      } catch (err) {
        const errorEvent: SSEData = {
          type: "error",
          error:
            err instanceof Error ? err.message : String(err),
        }
        controller.enqueue(
          encoder.encode(sseEncode(errorEvent))
        )
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      }
    },
  })
}
