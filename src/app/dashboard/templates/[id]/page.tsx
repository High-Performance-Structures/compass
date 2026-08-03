import { notFound } from "next/navigation"
import Link from "next/link"

import {
  getProjectTemplateContent,
  getProjectTemplatePreview,
} from "@/app/actions/project-templates"

import { getEstimateTemplateEditor } from "@/app/actions/estimate-templates"
import { EstimateTemplateEditorPanel } from "@/components/templates/estimate-template-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

export default async function EstimateTemplatePage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
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
              {preview.departmentCode && (
                <Badge variant="secondary">{preview.departmentCode}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {preview.tradeCategory ?? "Other"} · version {preview.currentVersionNumber ?? "draft"}
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

          {moduleNames.map((moduleType) => {
            const items = content.filter((item) => item.moduleType === moduleType)
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
