export async function getCloudflareContext(): Promise<never> {
    throw new Error("The local database context is unavailable in production.")
}
