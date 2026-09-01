export const dynamic = "force-dynamic"

import { resolveLegacyProjectRoute } from "@/lib/legacy-project-route-resolution"

export default async function LegacyProjectRoutePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    readonly sourceProjectId?: string | readonly string[]
    readonly suffix?: string | readonly string[]
    readonly originalSearch?: string | readonly string[]
  }>
}>): Promise<never> {
  return resolveLegacyProjectRoute(await searchParams)
}
