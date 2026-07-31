import {
  isJarvisVisualMediaType,
  MAX_JARVIS_VISUALS,
  MAX_JARVIS_VISUAL_DATA_URL_CHARACTERS,
  type JarvisVisualAttachment,
} from "@/lib/agent/visual-context"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsedPayload(serialized: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(serialized)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function isStoredVisual(value: unknown): value is JarvisVisualAttachment {
  if (!isRecord(value)) return false
  return (
    typeof value.filename === "string" &&
    value.filename.length > 0 &&
    value.filename.length <= 180 &&
    typeof value.mediaType === "string" &&
    isJarvisVisualMediaType(value.mediaType) &&
    typeof value.dataUrl === "string" &&
    value.dataUrl.length <= MAX_JARVIS_VISUAL_DATA_URL_CHARACTERS &&
    value.dataUrl.startsWith(`data:${value.mediaType};base64,`)
  )
}

export function storedJarvisVisuals(
  serializedPayload: string,
): readonly JarvisVisualAttachment[] {
  const payload = parsedPayload(serializedPayload)
  if (!payload || !isRecord(payload.visualContext)) return []
  const images = payload.visualContext.images
  if (!Array.isArray(images)) return []
  return images.filter(isStoredVisual).slice(0, MAX_JARVIS_VISUALS)
}

export function jarvisPayloadForDelivery(
  eventId: string,
  serializedPayload: string,
): unknown {
  const payload = parsedPayload(serializedPayload)
  if (!payload) return null
  const visuals = storedJarvisVisuals(serializedPayload)
  if (visuals.length === 0) return payload

  return {
    ...payload,
    visualContext: {
      explicitUserAttachments: true,
      available: true,
      endpoint: `/api/integrations/jarvis/events/${encodeURIComponent(
        eventId,
      )}/visuals`,
      images: visuals.map((visual) => ({
        filename: visual.filename,
        mediaType: visual.mediaType,
      })),
    },
  }
}

export function jarvisPayloadAfterCompletion(
  serializedPayload: string,
): string {
  const payload = parsedPayload(serializedPayload)
  if (!payload) return serializedPayload
  const visuals = storedJarvisVisuals(serializedPayload)
  if (visuals.length === 0) return serializedPayload

  return JSON.stringify({
    ...payload,
    visualContext: {
      explicitUserAttachments: true,
      processed: true,
      images: visuals.map((visual) => ({
        filename: visual.filename,
        mediaType: visual.mediaType,
      })),
    },
  })
}
