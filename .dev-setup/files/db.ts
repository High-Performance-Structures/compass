type CompassCloudflareContext = {
    env: CloudflareEnv
    ctx: {
        waitUntil: (promise: Promise<unknown>) => void
    }
    cf: unknown
}

function isWorkOSConfigured(): boolean {
    const apiKey = process.env.WORKOS_API_KEY ?? ""
    const clientId = process.env.WORKOS_CLIENT_ID ?? ""

    return (
        apiKey.length > 0 &&
        clientId.length > 0 &&
        !apiKey.includes("placeholder") &&
        !clientId.includes("placeholder")
    )
}

export async function getCloudflareContext(): Promise<CompassCloudflareContext> {
    const useCloudflareDevProxy =
        process.env.COMPASS_USE_CLOUDFLARE_DEV_PROXY === "true"
    const isLocalDev =
        process.env.NODE_ENV === "development" &&
        !useCloudflareDevProxy &&
        !isWorkOSConfigured()

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
