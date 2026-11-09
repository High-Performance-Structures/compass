// Gets the Cloudflare context (env bindings such as the D1 database) on the
// server, with a local fallback for development and E2E tests.
import { isE2ETest } from "@/lib/auth-config"

type CompassCloudflareContext = {
    env: CloudflareEnv
    ctx: {
        waitUntil: (promise: Promise<unknown>) => void
    }
    cf: unknown
}

export async function getCloudflareContext(): Promise<CompassCloudflareContext> {
    const useCloudflareDevProxy =
        process.env.COMPASS_USE_CLOUDFLARE_DEV_PROXY === "true"
    const isLocalDev =
        (process.env.NODE_ENV === "development" || isE2ETest()) &&
        !useCloudflareDevProxy

    if (isLocalDev) {
        return getLocalCloudflareContext()
    }

    const { getCloudflareContext: getCfContext } = await import(
        "@opennextjs/cloudflare"
    )
    try {
        return getCfContext()
    } catch (error) {
        if (
            (process.env.NODE_ENV === "development" || isE2ETest()) &&
            error instanceof Error &&
            error.message.includes("initOpenNextCloudflareForDev")
        ) {
            return getLocalCloudflareContext()
        }
        throw error
    }
}

async function getLocalCloudflareContext(): Promise<CompassCloudflareContext> {
    const { getCloudflareContext: getLocalContext } = await import(
        "@/lib/cloudflare-context"
    )
    return getLocalContext()
}
