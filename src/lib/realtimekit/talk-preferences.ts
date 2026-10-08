import { z } from "zod/v4"

const imageSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  url: z
    .string()
    .max(400_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
})

const backgroundSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("blur"),
    strength: z.number().int().min(10).max(100)
  }),
  z.object({ mode: z.literal("image"), imageId: z.string().min(1).max(80) })
])

const preferencesSchema = z.object({
  version: z.literal(1),
  background: backgroundSchema,
  backgroundCleanup: z.enum(["standard", "strong"]).default("standard"),
  images: z.array(imageSchema).max(6),
  cameraId: z.string().max(256),
  microphoneId: z.string().max(256),
  speakerId: z.string().max(256),
  joinWithCamera: z.boolean(),
  joinWithMicrophone: z.boolean(),
  // Opt-in; added after v1 shipped, so older saved preferences default it off.
  mutedSpeechHint: z.boolean().default(false)
})

export type TalkBackground = Readonly<z.infer<typeof backgroundSchema>>
export type TalkCleanup = TalkPreferences["backgroundCleanup"]
export type TalkImage = Readonly<z.infer<typeof imageSchema>>
export type TalkPreferences = Omit<
  Readonly<z.infer<typeof preferencesSchema>>,
  "images"
> & {
  readonly images: readonly TalkImage[]
}

export const TALK_BACKGROUNDS: readonly TalkImage[] = [
  {
    id: "hps",
    name: "High Performance Structures",
    url: "/meeting-backgrounds/hps.svg"
  },
  {
    id: "orc",
    name: "Open Range Construction",
    url: "/meeting-backgrounds/orc.svg"
  },
  {
    id: "office",
    name: "Quiet office",
    url: "/meeting-backgrounds/office.svg"
  },
  {
    id: "mountains",
    name: "Mountain illustration",
    url: "/meeting-backgrounds/mountains.svg"
  },
  {
    id: "beach",
    name: "Palm beach",
    url: "https://rtk-assets.realtime.cloudflare.com/backgrounds/bg_1.jpg"
  },
  {
    id: "wave",
    name: "Blue wave",
    url: "https://rtk-assets.realtime.cloudflare.com/backgrounds/bg_2.jpg"
  }
]

export function defaultTalkPreferences(): TalkPreferences {
  return {
    version: 1,
    background: { mode: "none" },
    backgroundCleanup: "standard",
    images: [],
    cameraId: "",
    microphoneId: "",
    speakerId: "",
    joinWithCamera: false,
    joinWithMicrophone: false,
    mutedSpeechHint: false
  }
}

export function parseTalkPreferences(raw: string | null): TalkPreferences {
  if (!raw || raw.length > 2_500_000) return defaultTalkPreferences()
  try {
    const result = preferencesSchema.safeParse(JSON.parse(raw))
    if (!result.success) return defaultTalkPreferences()
    const preferences = result.data
    const background = preferences.background
    if (
      background.mode === "image" &&
      ![...TALK_BACKGROUNDS, ...preferences.images].some(
        (image) => image.id === background.imageId
      )
    ) {
      return { ...preferences, background: { mode: "none" } }
    }
    return preferences
  } catch {
    return defaultTalkPreferences()
  }
}

export function talkPreferencesKey(userId: string): string {
  return `compass:talk:preferences:v1:${userId}`
}

export function removeTalkImage(
  preferences: TalkPreferences,
  id: string
): TalkPreferences {
  return {
    ...preferences,
    images: preferences.images.filter((image) => image.id !== id),
    background:
      preferences.background.mode === "image" &&
      preferences.background.imageId === id
        ? { mode: "none" }
        : preferences.background
  }
}

export type CropRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function talkImageCrop(
  width: number,
  height: number,
  zoom: number,
  x: number,
  y: number
): CropRect {
  const cropWidth = Math.min(width, (height * 16) / 9) / zoom
  const cropHeight = (cropWidth * 9) / 16
  return {
    x: ((width - cropWidth) * x) / 100,
    y: ((height - cropHeight) * y) / 100,
    width: cropWidth,
    height: cropHeight
  }
}
