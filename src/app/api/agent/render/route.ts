import { streamText } from "ai"
import { getAgentModel } from "@/lib/agent/provider"
import { getCurrentUser } from "@/lib/auth"
import { compassCatalog } from "@/lib/agent/render/catalog"

const SYSTEM_PROMPT = compassCatalog.prompt({
  customRules: [
    "Card should be root element for dashboards",
    "Use Grid/Stack for layouts, not nested Cards",
    "NEVER use viewport height classes " +
      "(min-h-screen, h-screen)",
    "NEVER use page background colors " +
      "(bg-gray-50) - container has its own background",
    "Use real data from the AVAILABLE DATA section",
    "Prefer DataTable for tabular data, " +
      "StatCard for single metrics",
    "InvoiceTable for invoice-specific data",
    "SchedulePreview for project schedule tasks",
    "ProjectSummary for project overviews",
  ],
})

const MAX_PROMPT_LENGTH = 2000

export async function POST(
  req: Request
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { prompt, context } = (await req.json()) as {
    prompt: string
    context?: Record<string, unknown>
  }

  const previousSpec = context?.previousSpec as
    | { root?: string; elements?: Record<string, unknown> }
    | undefined

  const sanitizedPrompt = String(prompt || "").slice(
    0,
    MAX_PROMPT_LENGTH
  )

  let userPrompt = sanitizedPrompt

  // include data context if provided
  const dataContext = context?.dataContext as
    | Record<string, unknown>
    | undefined
  if (dataContext && Object.keys(dataContext).length > 0) {
    userPrompt += `\n\nAVAILABLE DATA:\n${JSON.stringify(dataContext, null, 2)}`
  }

  // include previous spec for iterative updates
  if (
    previousSpec?.root &&
    previousSpec.elements &&
    Object.keys(previousSpec.elements).length > 0
  ) {
    userPrompt = `CURRENT UI STATE (already loaded, DO NOT recreate existing elements):
${JSON.stringify(previousSpec, null, 2)}

USER REQUEST: ${userPrompt}

IMPORTANT: The current UI is already loaded. Output ONLY the patches needed to make the requested change:
- To add a new element: {"op":"add","path":"/elements/new-key","value":{...}}
- To modify an existing element: {"op":"set","path":"/elements/existing-key","value":{...}}
- To update the root: {"op":"set","path":"/root","value":"new-root-key"}
- To add children: update the parent element with new children array

DO NOT output patches for elements that don't need to change. Only output what's necessary for the requested modification.`
  }

  const model = await getAgentModel()

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.7,
  })

  return result.toTextStreamResponse()
}
