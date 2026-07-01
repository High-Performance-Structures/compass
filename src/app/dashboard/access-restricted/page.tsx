import type * as React from "react"
import Link from "next/link"
import { IconArrowLeft, IconLockAccess } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { getPermissionFeature } from "@/lib/permissions"

export const dynamic = "force-dynamic"

function searchValue(value: string | readonly string[] | undefined): string {
  if (typeof value === "string") return value
  return value?.[0] ?? ""
}

export default async function AccessRestrictedPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly feature?: string | readonly string[]
    readonly action?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const query = await searchParams
  const featureId = searchValue(query.feature)
  const action = searchValue(query.action)
  const feature = featureId.length > 0 ? getPermissionFeature(featureId) : null
  const featureLabel = feature?.label ?? "this Compass area"
  const actionLabel = action.length > 0 ? action : "access"

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-3xl items-center justify-center p-6">
      <section className="w-full border-l-4 border-[var(--department-primary)] bg-background px-6 py-8 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-border bg-muted">
            <IconLockAccess className="size-6 text-[var(--department-primary)]" />
          </div>
          <div className="min-w-0 space-y-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Access restricted
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">
                You do not have permission to {actionLabel} {featureLabel}.
              </h1>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              This is a Compass permissions setting, not a site error. Contact
              your Compass administrator if you need access for your role or
              project work.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/dashboard">
                  <IconArrowLeft className="size-4" />
                  Dashboard
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard/projects">Projects</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
