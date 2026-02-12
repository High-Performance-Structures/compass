export async function getCloudflareContext(): Promise<{
    env: {
        DB: D1Database
        [key: string]: unknown
    }
    ctx: {
        waitUntil: (promise: Promise<unknown>) => void
    }
    cf: unknown
}> {
    const isLocalDev =
        process.env.NODE_ENV === "development" &&
        (!process.env.WORKOS_API_KEY ||
            process.env.WORKOS_API_KEY.includes("placeholder"))

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
