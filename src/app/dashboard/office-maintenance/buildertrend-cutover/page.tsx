export const dynamic = "force-dynamic"

import Link from "next/link"
import { redirect } from "next/navigation"
import { IconArrowLeft, IconDatabase } from "@tabler/icons-react"

import { getBuildertrendCutoverCoverage } from "@/app/actions/buildertrend-cutover-coverage"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getCurrentUser } from "@/lib/auth"
import { canManageProjectRegistry } from "@/lib/permissions"
import { isDeveloperModeEnabled } from "@/lib/developer-mode-server"

function generatedLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default async function BuildertrendCutoverPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  const developerModeEnabled = await isDeveloperModeEnabled(
    canManageProjectRegistry(user),
  )
  if (!developerModeEnabled) redirect("/dashboard")

  const coverage = await getBuildertrendCutoverCoverage()

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 lg:p-6">
      <header className="border-b pb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link href="/dashboard">
            <IconArrowLeft className="size-4" />
            Dashboard
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <IconDatabase className="size-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Buildertrend cutover coverage
          </h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          A module is complete only when its captured count is attested, or a
          signed capture confirms that Buildertrend contained zero records.
          Existing records without that final check remain partial. Evidence
          for live or unclassified projects becomes stale after seven days.
        </p>
      </header>

      <section className="grid gap-px border bg-border sm:grid-cols-4">
        <div className="bg-background p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Mapped projects
          </p>
          <p className="mt-1 text-2xl font-semibold">{coverage.projectCount}</p>
        </div>
        <div className="bg-background p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Required modules
          </p>
          <p className="mt-1 text-2xl font-semibold">{coverage.moduleCount}</p>
        </div>
        <div className="bg-background p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Verified checks
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {coverage.verifiedChecks} / {coverage.totalChecks}
          </p>
        </div>
        <div className="bg-background p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Evidence complete
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {coverage.completionPercent}%
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Project lifecycle inventory</h2>
        <div className="flex flex-wrap gap-2">
          {coverage.statusCounts.map((item) => (
            <Badge key={item.status} variant="outline">
              {item.status} {item.count}
            </Badge>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Module evidence</h2>
          <p className="text-sm text-muted-foreground">
            “Partial” includes captured records that have not received a
            matching completeness attestation. “Conflict” means the attested
            count no longer matches staged evidence. “Stale” requires a fresh
            Buildertrend check before cutover.
          </p>
        </div>
        <div className="overflow-x-auto border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Module</th>
                <th className="px-3 py-3 text-right font-medium">Captured</th>
                <th className="px-3 py-3 text-right font-medium">Empty</th>
                <th className="px-3 py-3 text-right font-medium">Partial</th>
                <th className="px-3 py-3 text-right font-medium">Stale</th>
                <th className="px-3 py-3 text-right font-medium">
                  Blocked / unavailable
                </th>
                <th className="px-3 py-3 text-right font-medium">Conflict</th>
                <th className="px-3 py-3 text-right font-medium">Missing</th>
                <th className="px-3 py-3 text-right font-medium">Complete</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {coverage.modules.map((module) => (
                <tr key={module.key}>
                  <th className="px-3 py-3 text-left font-medium">
                    {module.label}
                  </th>
                  <td className="px-3 py-3 text-right">
                    {module.verifiedCapturedCount}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {module.verifiedEmptyCount}
                  </td>
                  <td className="px-3 py-3 text-right">{module.partialCount}</td>
                  <td className="px-3 py-3 text-right">{module.staleCount}</td>
                  <td className="px-3 py-3 text-right">
                    {module.blockedCount + module.unavailableCount}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {module.conflictCount}
                  </td>
                  <td className="px-3 py-3 text-right">{module.missingCount}</td>
                  <td className="px-3 py-3 text-right font-medium">
                    {module.completionPercent}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Generated {generatedLabel(coverage.generatedAt)}. This screen is
          read-only and does not promote records or grant portal access.
        </p>
      </section>
    </main>
  )
}
