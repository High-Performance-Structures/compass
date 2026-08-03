import { notFound } from "next/navigation"

import { getEstimateTemplateEditor } from "@/app/actions/estimate-templates"
import { EstimateTemplateEditorPanel } from "@/components/templates/estimate-template-editor"

export const dynamic = "force-dynamic"

export default async function EstimateTemplatePage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  const editor = await getEstimateTemplateEditor(id)
  if (!editor) notFound()
  return <EstimateTemplateEditorPanel editor={editor} />
}
