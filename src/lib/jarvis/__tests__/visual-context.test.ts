import { describe, expect, it } from "vitest"

import {
  jarvisPayloadAfterCompletion,
  jarvisPayloadForDelivery,
  storedJarvisVisuals,
} from "@/lib/jarvis/visual-context"

const tinyPng = "data:image/png;base64,iVBORw0KGgo="

describe("Jarvis visual context", () => {
  it("accepts only bounded, declared image attachments", () => {
    const payload = JSON.stringify({
      visualContext: {
        explicitUserAttachments: true,
        images: [
          {
            filename: "schedule.png",
            mediaType: "image/png",
            dataUrl: tinyPng,
          },
          {
            filename: "instructions.txt",
            mediaType: "text/plain",
            dataUrl: "data:text/plain;base64,aGVsbG8=",
          },
        ],
      },
    })

    expect(storedJarvisVisuals(payload)).toEqual([
      {
        filename: "schedule.png",
        mediaType: "image/png",
        dataUrl: tinyPng,
      },
    ])
  })

  it("removes image bytes from the normal event poll response", () => {
    const delivered = jarvisPayloadForDelivery(
      "event one",
      JSON.stringify({
        messages: [{ role: "user", content: "Review this" }],
        visualContext: {
          explicitUserAttachments: true,
          images: [
            {
              filename: "schedule.png",
              mediaType: "image/png",
              dataUrl: tinyPng,
            },
          ],
        },
      }),
    )

    expect(delivered).toEqual({
      messages: [{ role: "user", content: "Review this" }],
      visualContext: {
        explicitUserAttachments: true,
        available: true,
        endpoint:
          "/api/integrations/jarvis/events/event%20one/visuals",
        images: [
          {
            filename: "schedule.png",
            mediaType: "image/png",
          },
        ],
      },
    })
    expect(JSON.stringify(delivered)).not.toContain(tinyPng)
  })

  it("removes image bytes permanently after the prompt is acknowledged", () => {
    const completed = jarvisPayloadAfterCompletion(
      JSON.stringify({
        visualContext: {
          explicitUserAttachments: true,
          images: [
            {
              filename: "schedule.png",
              mediaType: "image/png",
              dataUrl: tinyPng,
            },
          ],
        },
      }),
    )

    expect(completed).not.toContain(tinyPng)
    expect(JSON.parse(completed)).toEqual({
      visualContext: {
        explicitUserAttachments: true,
        processed: true,
        images: [
          {
            filename: "schedule.png",
            mediaType: "image/png",
          },
        ],
      },
    })
  })
})
