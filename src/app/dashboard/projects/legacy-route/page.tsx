export const dynamic = "force-dynamic"

import { ClientRedirect } from "@/components/client-redirect"
import { legacyProjectRouteDestination } from "@/lib/legacy-project-route-resolution"

export default async function LegacyProjectRoutePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    readonly sourceProjectId?: string | readonly string[]
    readonly suffix?: string | readonly string[]
    readonly originalSearch?: string | readonly string[]
  }>
}>): Promise<React.ReactElement> {
  return <ClientRedirect href={await legacyProjectRouteDestination(await searchParams)} />
}
