import { notFound } from "next/navigation"
import Link from "next/link"

import {
  getProjectTemplateContent,
  getProjectTemplatePreview,
} from "@/app/actions/project-templates"

import { getEstimateTemplateEditor } from "@/app/actions/estimate-templates"
import { EstimateTemplateEditorPanel } from "@/components/templates/estimate-template-editor"
import { DeveloperOnly } from "@/components/developer-mode-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { normalizeTemplateBidPackage } from "@/lib/templates/template-bid-package"
import { groupTemplateChecklistItems } from "@/lib/templates/template-checklist-hierarchy"
import { resolveTemplateDetailId } from "@/lib/templates/template-detail-route"
import { buildTemplateSelectionHierarchy } from "@/lib/templates/template-selection-hierarchy"

export const dynamic = "force-dynamic"

export default async function EstimateTemplatePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{
    readonly templateId?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const [{ id: routeId }, query] = await Promise.all([params, searchParams])
  const id = resolveTemplateDetailId(routeId, query.templateId)
  if (!id) notFound()
  const preview = await getProjectTemplatePreview(id)
  if (!preview) notFound()
  if (preview.templateKind === "estimate") {
    const editor = await getEstimateTemplateEditor(id)
    if (!editor) notFound()
    return <EstimateTemplateEditorPanel editor={editor} />
  }

  const content = await getProjectTemplateContent(id)
  const moduleNames = [...new Set(content.map((item) => item.moduleType))]
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{preview.name}</h1>
              <Badge variant="outline">
                {preview.templateKind === "project" ? "Project" : "Assembly"}
              </Badge>
              {preview.tradeCategory && (
                <Badge variant="secondary">{preview.tradeCategory}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {preview.tradeCategory ?? "Other"}
              <DeveloperOnly>
                {` · version ${preview.currentVersionNumber ?? "draft"}`}
              </DeveloperOnly>
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/dashboard/templates">Back to templates</Link>
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="space-y-8">
          {preview.scheduleItems.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline justify-between border-b pb-2">
                <h2 className="font-semibold">Schedule items</h2>
                <span className="text-xs text-muted-foreground">{preview.scheduleItems.length} items</span>
              </div>
              <div className="divide-y border-y">
                {preview.scheduleItems.map((item, index) => (
                  <div key={`${item.title}-${index}`} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.phase}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.workdays} workday{item.workdays === 1 ? "" : "s"}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {preview.modules.length > 0 && (
            <DeveloperOnly>
            <section>
              <div className="mb-2 border-b pb-2">
                <h2 className="font-semibold">Capture review</h2>
              </div>
              <div className="divide-y border-y">
                {preview.modules.map((module) => (
                  <div
                    key={module.moduleType}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <span className="capitalize">
                      {module.moduleType.replaceAll("_", " ")}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {module.sourceItemCount} source items
                      </span>
                      <Badge
                        variant={
                          module.normalizationStatus === "captured_with_warnings"
                            ? "outline"
                            : "secondary"
                        }
                      >
                        {module.normalizationStatus === "captured_with_warnings"
                          ? "Captured with warnings"
                          : module.normalizationStatus.replaceAll("_", " ")}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            </DeveloperOnly>
          )}

          {moduleNames.map((moduleType) => {
            const items = content.filter((item) => item.moduleType === moduleType)
            if (moduleType === "tasks") {
              const taskGroups = groupTemplateChecklistItems(items)
              const checklistItemCount = items.length - taskGroups.length
              return (
                <section key={moduleType}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
                    <h2 className="font-semibold">Tasks and checklists</h2>
                    <span className="text-xs text-muted-foreground">
                      {taskGroups.length} tasks · {checklistItemCount} checklist items
                    </span>
                  </div>
                  <div className="divide-y border-y">
                    {taskGroups.map(({ task, checklistItems }) => (
                      <article key={task.id} className="py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">{task.title}</h3>
                          {task.category && (
                            <Badge variant="outline">{task.category}</Badge>
                          )}
                        </div>
                        {task.description && (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                            {task.description}
                          </p>
                        )}
                        {checklistItems.length > 0 && (
                          <div className="mt-3 border-l-2 border-primary/40 pl-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Checklist · {checklistItems.length}
                            </p>
                            <ul className="mt-2 space-y-2">
                              {checklistItems.map((checklistItem) => (
                                <li
                                  key={checklistItem.id}
                                  className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-sm"
                                >
                                  <span aria-hidden="true">☐</span>
                                  <div>
                                    <p>{checklistItem.title}</p>
                                    {checklistItem.description && (
                                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                                        {checklistItem.description}
                                      </p>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )
            }
            if (moduleType === "bid_packages") {
              return (
                <section key={moduleType}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
                    <h2 className="font-semibold">Bid packages → draft RFQs</h2>
                    <span className="text-xs text-muted-foreground">
                      {items.length} draft RFQ{items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="divide-y border-y">
                    {items.map((item) => {
                      const normalized = normalizeTemplateBidPackage({
                        title: item.title,
                        description: item.description,
                        payloadJson: item.payloadJson,
                      })
                      return (
                        <article key={item.id} className="py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium">{item.title}</h3>
                            <Badge variant="outline">Draft RFQ</Badge>
                            {normalized.vendorCategory && (
                              <Badge variant="secondary">
                                {normalized.vendorCategory}
                              </Badge>
                            )}
                          </div>
                          {normalized.overallScope && (
                            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                              {normalized.overallScope}
                            </p>
                          )}
                          {normalized.scopeItems.length > 0 && (
                            <div className="mt-4 overflow-x-auto border-y">
                              <div className="grid min-w-[640px] grid-cols-[2rem_minmax(14rem,1fr)_7rem_minmax(10rem,.7fr)] gap-2 border-b py-2 text-xs font-medium text-muted-foreground">
                                <span>#</span>
                                <span>Scope</span>
                                <span>Cost code</span>
                                <span>Notes</span>
                              </div>
                              {normalized.scopeItems.map((line) => (
                                <div
                                  key={`${item.id}-${line.lineNumber}`}
                                  className="grid min-w-[640px] grid-cols-[2rem_minmax(14rem,1fr)_7rem_minmax(10rem,.7fr)] gap-2 border-b py-2 text-sm last:border-b-0"
                                >
                                  <span>{line.lineNumber}</span>
                                  <span>{line.description}</span>
                                  <span>{line.costCode ?? "-"}</span>
                                  <span className="text-muted-foreground">
                                    {line.notes ?? "-"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {normalized.templateReview && (
                            <div className="mt-4 border-l-2 border-amber-500 px-3 py-2 text-sm">
                              <p className="font-medium">Review before sending</p>
                              {normalized.templateReview.unresolvedPlaceholders.length > 0 && (
                                <p className="mt-1 text-muted-foreground">
                                  Replace: {normalized.templateReview.unresolvedPlaceholders.join(", ")}
                                </p>
                              )}
                              {normalized.templateReview.requiresDocumentPackage && (
                                <p className="mt-1 text-muted-foreground">
                                  Add the project plans/specifications package link.
                                </p>
                              )}
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </section>
              )
            }
            if (moduleType === "selections") {
              const hierarchy = buildTemplateSelectionHierarchy(
                items.map((item) => ({
                  id: item.id,
                  title: item.title,
                  payloadJson: item.payloadJson,
                  sortOrder: item.sortOrder,
                }))
              )
              const itemById = new Map(items.map((item) => [item.id, item]))
              const childrenByParent = new Map<string, typeof hierarchy>()
              for (const relation of hierarchy) {
                if (!relation.parentItemId) continue
                const children = childrenByParent.get(relation.parentItemId) ?? []
                childrenByParent.set(relation.parentItemId, [...children, relation])
              }
              const roots = hierarchy.filter((relation) => !relation.parentItemId)

              function renderSelection(
                relation: (typeof hierarchy)[number]
              ): React.ReactNode {
                const item = itemById.get(relation.itemId)
                if (!item) return null
                const children = childrenByParent.get(relation.itemId) ?? []
                return (
                  <li key={item.id} className="border-l-2 border-primary/30 pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.title}</span>
                      {relation.parentChoiceValue && (
                        <Badge variant="secondary">
                          After {relation.parentChoiceValue}
                        </Badge>
                      )}
                    </div>
                    {relation.choiceOptions.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Choose: {relation.choiceOptions.join(" · ")}
                      </p>
                    )}
                    {children.length > 0 && (
                      <details className="mt-2" open={relation.level === 0}>
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                          {children.length} dependent selection
                          {children.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-3 space-y-3">
                          {children.map(renderSelection)}
                        </ul>
                      </details>
                    )}
                  </li>
                )
              }

              return (
                <section key={moduleType}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
                    <h2 className="font-semibold">Finish selection hierarchy</h2>
                    <span className="text-xs text-muted-foreground">
                      {items.length} selections · dependent choices open as their parent is selected
                    </span>
                  </div>
                  <ul className="space-y-4 border-y py-4">
                    {roots.map(renderSelection)}
                  </ul>
                </section>
              )
            }
            return (
              <section key={moduleType}>
                <div className="mb-2 flex items-baseline justify-between border-b pb-2">
                  <h2 className="font-semibold capitalize">{moduleType.replaceAll("_", " ")}</h2>
                  <span className="text-xs text-muted-foreground">{items.length} items</span>
                </div>
                <div className="divide-y border-y">
                  {items.map((item) => (
                    <div key={item.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{item.title}</p>
                        {item.category && <Badge variant="outline">{item.category}</Badge>}
                      </div>
                      {item.description && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}

          {preview.scheduleItems.length === 0 && content.length === 0 && (
            <div className="border-y py-10 text-sm text-muted-foreground">
              This template does not contain reusable content yet.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
