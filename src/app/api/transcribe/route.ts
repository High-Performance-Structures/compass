import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getCurrentUser } from "@/lib/auth"

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  const formData = await req.formData()
  const audioFile = formData.get("audio")

  if (!(audioFile instanceof Blob)) {
    return Response.json(
      { error: "Missing audio blob in form data" },
      { status: 400 }
    )
  }

  const { env } = await getCloudflareContext()
  const buffer = await audioFile.arrayBuffer()

  const result = await env.AI.run(
    "@cf/openai/whisper-large-v3-turbo",
    {
      audio: toBase64(buffer),
      task: "transcribe",
      vad_filter: true,
    }
  )

  return Response.json({
    text: result.text.trim(),
    duration: result.transcription_info?.duration ?? 0,
  })
}
