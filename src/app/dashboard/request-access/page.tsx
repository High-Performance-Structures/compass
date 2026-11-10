import type * as React from "react"

import { getRequestAccessPageData } from "@/app/actions/access-requests"
import { RequestAccessPanel } from "@/components/access-requests/request-access-panel"

export const dynamic = "force-dynamic"

/** Request access to a company in Compass, and see where your requests stand. */
export default async function RequestAccessPage(): Promise<React.ReactElement> {
  const result = await getRequestAccessPageData()
  if (!result.success) {
    return (
      <main className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">{result.error}</p>
      </main>
    )
  }
  return <RequestAccessPanel data={result.data} />
}
