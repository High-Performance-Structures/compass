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
        process.env.NODE_ENV === "development" && !useCloudflareDevProxy

    if (isLocalDev) {
        const { getCloudflareContext: getLocalContext } = await import(
            "./cloudflare-context"
        )
        return getLocalContext()
    }

    const { getCloudflareContext: getCfContext } = await import(
        "@opennextjs/cloudflare"
    )
    return getCfContext()
}
