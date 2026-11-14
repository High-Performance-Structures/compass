// Gets the Cloudflare context (env bindings such as the D1 database) on the
// server, with a local fallback for development and E2E tests.
//
// View as (src/lib/view-as/): while a request carries the View as cookie,
// getCloudflareContext() returns read-only database and storage bindings, so
// every write in a server action, API route or page fails closed no matter
// how it reaches D1. Only the View as module itself and sign-in housekeeping
// for the admin's own account use getUnguardedCloudflareContext().
import { isE2ETest } from "@/lib/auth-config"
import { installViewAsFetchGuard } from "@/lib/view-as/fetch-guard"
import { isViewAsRequest, viewAsGuardMode } from "@/lib/view-as/request"
import { readOnlyEnv } from "@/lib/view-as/write-guard"

type CompassCloudflareContext = {
    env: CloudflareEnv
    ctx: {
        waitUntil: (promise: Promise<unknown>) => void
    }
    cf: unknown
}

export async function getCloudflareContext(): Promise<CompassCloudflareContext> {
    installViewAsFetchGuard(isViewAsRequest)
    const context = await getUnguardedCloudflareContext()
    if (!(await isViewAsRequest())) return context
    return { ...context, env: readOnlyEnv(context.env, await viewAsGuardMode()) }
}

/**
 * The real, writable bindings even during View as. Restricted by
 * src/lib/view-as/__tests__/unguarded-context.test.ts to the View as module
 * and auth; everything else must call getCloudflareContext().
 */
export async function getUnguardedCloudflareContext(): Promise<CompassCloudflareContext> {
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
