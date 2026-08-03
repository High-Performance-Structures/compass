import Link from "next/link"
import {
  IconArrowLeft,
  IconCircleCheck,
  IconClockHour4,
  IconExternalLink,
  IconTemplate,
} from "@tabler/icons-react"

import { getProjectTemplateLibrary } from "@/app/actions/project-templates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EstimateTemplateCreateDialog } from "@/components/templates/estimate-template-create-dialog"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

export const dynamic = "force-dynamic"

function reviewLabel(reviewStatus: string): string {
  switch (reviewStatus) {
    case "verified":
      return "Verified"
    case "content_captured":
      return "Content captured"
    default:
      return "Inventory only"
  }
}

export default async function TemplateLibraryPage() {
  const [templates, user] = await Promise.all([
    getProjectTemplateLibrary(),
    getCurrentUser(),
  ])
  const canManageEstimateTemplates =
    Boolean(user && isInternalStaffRole(user.role)) &&
    can(user, "budget", "update")
  const readyCount = templates.filter(
    (template) =>
      template.lifecycleStatus === "active" &&
      template.reviewStatus === "verified"
  ).length
  const inventoryCount = templates.filter(
    (template) => template.reviewStatus === "inventory_only"
  ).length
  const categories = [
    ...new Set(
      templates.map((template) => template.tradeCategory ?? "Other")
    ),
  ].sort((left, right) => left.localeCompare(right))

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
              <IconTemplate className="size-4" />
              Project setup
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Template Library
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Reusable project assemblies remain separate from live project
              records until they are reviewed and applied.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManageEstimateTemplates && <EstimateTemplateCreateDialog />}
            <Button asChild variant="outline">
              <Link href="/dashboard/schedule">
                <IconArrowLeft className="mr-2 size-4" />
                Back to schedules
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
          <span>{templates.length} templates in the library</span>
          <span className="text-muted-foreground">{inventoryCount} awaiting content capture</span>
          <span className="text-muted-foreground">{readyCount} verified and usable</span>
          <span className="font-medium text-amber-700 dark:text-amber-300">
            Archived Buildertrend templates excluded
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {templates.length === 0 ? (
          <div className="max-w-2xl border-y py-10">
            <h2 className="font-medium">The Template Library is ready for inventory.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Run the guarded Buildertrend inventory importer, then capture and
              verify each active template before making it available to projects.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {categories.map((category) => {
              const categoryTemplates = templates.filter(
                (template) => (template.tradeCategory ?? "Other") === category
              )
              return (
                <section key={category} aria-labelledby={`category-${category}`}>
                  <div className="mb-2 flex items-baseline justify-between border-b pb-2">
                    <h2 id={`category-${category}`} className="font-semibold">
                      {category}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {categoryTemplates.length} template
                      {categoryTemplates.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="divide-y border-y">
                    {categoryTemplates.map((template) => {
                      const ready =
                        template.lifecycleStatus === "active" &&
                        template.reviewStatus === "verified" &&
                        template.currentVersionStatus === "published"
                      return (
                        <div
                          key={template.id}
                          className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium">{template.name}</p>
                              <Badge variant="outline">
                                {template.templateKind === "project"
                                  ? "Project"
                                  : template.templateKind === "estimate"
                                    ? "Estimate"
                                    : "Assembly"}
                              </Badge>
                              {template.departmentCode && (
                                <Badge variant="secondary">
                                  {template.departmentCode}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {template.templateKind === "estimate"
                                ? `${
                                    template.modules.find(
                                      (module) => module.moduleType === "estimate"
                                    )?.sourceItemCount ?? 0
                                  } estimate lines`
                                : `${template.scheduleItemCount} schedule items · ${template.dependencyCount} dependencies`}
                              {template.currentVersionNumber
                                ? ` · version ${template.currentVersionNumber}`
                                : " · content capture pending"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            {ready ? (
                              <IconCircleCheck className="size-4 text-emerald-600" />
                            ) : (
                              <IconClockHour4 className="size-4 text-amber-600" />
                            )}
                            {reviewLabel(template.reviewStatus)}
                          </div>
                          <div className="flex justify-end">
                            {template.templateKind === "estimate" && (
                              <Button asChild size="sm" variant="outline">
                                <Link href={`/dashboard/templates/${template.id}`}>
                                  Edit
                                </Link>
                              </Button>
                            )}
                            {template.sourceUrl && (
                              <Button asChild size="sm" variant="ghost">
                                <a
                                  href={template.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Source
                                  <IconExternalLink className="ml-2 size-3.5" />
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
