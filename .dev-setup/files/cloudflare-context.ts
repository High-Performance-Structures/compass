import { getCloudflareContext as originalGetCloudflareContext } from "@opennextjs/cloudflare"

const isWorkOSConfigured =
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  !process.env.WORKOS_API_KEY.includes("your_") &&
  !process.env.WORKOS_API_KEY.includes("placeholder")

export async function getCloudflareContext() {
  if (!isWorkOSConfigured) {
    return {
      env: {
        DB: null,
      },
      ctx: {},
    } as Awaited<ReturnType<typeof originalGetCloudflareContext>>
  }

  return originalGetCloudflareContext()
}
