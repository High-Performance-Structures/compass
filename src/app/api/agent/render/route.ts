import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getCurrentUser } from "@/lib/auth"
import { compassCatalog } from "@/lib/agent/render/catalog"
import { getDb } from "@/db"
import { agentConfig } from "@/db/schema-ai-config"
import { eq } from "drizzle-orm"

const DEFAULT_MODEL_ID = "qwen/qwen3-coder-next"

const SYSTEM_PROMPT = compassCatalog.prompt({
  customRules: [
    "Card should be root element for dashboards",
    "Use Grid/Stack for layouts, not nested Cards",
    "NEVER use viewport height classes " +
      "(min-h-screen, h-screen)",
    "NEVER use page background colors " +
      "(bg-gray-50) - container has its own background",
    "Use real data from the AVAILABLE DATA section",
    "ALWAYS use SchedulePreview for ANY schedule " +
      "or timeline display. Set groupByPhase=true. " +
      "NEVER compose schedules from primitives.",
    "ALWAYS use StatCard for single metrics",
    "ALWAYS use DataTable for tabular data - " +
      "use format='badge' for status columns",
    "ALWAYS use InvoiceTable for invoice-specific data",
    "ProjectSummary for project overviews",
    "Badge variant should match semantic meaning: " +
      "success for complete/paid, warning for pending, " +
      "danger for overdue/delayed",
    "Use CodeBlock for code snippets with appropriate " +
      "language identifier",
    "ALWAYS use DiffView for git diffs and code " +
      "changes - pass files array from commit_diff data",
    "Use Form component to wrap inputs when creating " +
      "or editing records. Set action to dotted name " +
      "(e.g. 'customer.create') and formId to a unique " +
      "string. For edits, set value prop on inputs and " +
      "pass record id via actionParams.",
    "For to-do lists / checklists, use Checkbox with " +
      "onChangeAction='agentItem.toggle' and " +
      "onChangeParams={id: '<item-id>'}.",
    "For tables with delete buttons, use DataTable " +
      "with rowIdKey='id' and rowActions=[{label: " +
      "'Delete', action: 'customer.delete', " +
      "variant: 'danger'}].",
    "Available mutation actions: customer.create, " +
      "customer.update, customer.delete, " +
      "vendor.create, vendor.update, vendor.delete, " +
      "invoice.create, invoice.update, invoice.delete, " +
      "vendorBill.create, vendorBill.update, " +
      "vendorBill.delete, schedule.create, " +
      "schedule.update, schedule.delete, " +
      "agentItem.create, agentItem.update, " +
      "agentItem.delete, agentItem.toggle",
  ],
})

const MAX_PROMPT_LENGTH = 2000

async function getModelConfig(): Promise<{
  apiKey: string
  modelId: string
}> {
  const { env } = await getCloudflareContext()
  const apiKey = (env as unknown as Record<string, string>)
    .OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured")
  }

  const db = getDb(env.DB)
  const config = await db
    .select({ modelId: agentConfig.modelId })
    .from(agentConfig)
    .where(eq(agentConfig.id, "global"))
    .get()

  return {
    apiKey,
    modelId: config?.modelId ?? DEFAULT_MODEL_ID,
  }
}

export async function POST(
  req: Request
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  let body: {
    prompt?: string
    context?: Record<string, unknown>
  }
  try {
    body = (await req.json()) as {
      prompt?: string
      context?: Record<string, unknown>
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  const { prompt, context } = body

  const previousSpec = context?.previousSpec as
    | {
        root?: string
        elements?: Record<string, unknown>
      }
    | undefined

  const sanitizedPrompt = String(prompt || "").slice(
    0,
    MAX_PROMPT_LENGTH
  )

  let userPrompt = sanitizedPrompt

  const dataContext = context?.dataContext as
    | Record<string, unknown>
    | undefined
  if (dataContext && Object.keys(dataContext).length > 0) {
    userPrompt +=
      `\n\nAVAILABLE DATA:\n` +
      JSON.stringify(dataContext, null, 2)
  }

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

  const { apiKey, modelId } = await getModelConfig()

  // call OpenRouter directly (OpenAI-compatible streaming)
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://compass.build",
        "X-Title": "Compass",
      },
      body: JSON.stringify({
        model: modelId,
        stream: true,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    }
  )

  if (!response.ok || !response.body) {
    return new Response("Model API error", {
      status: 502,
    })
  }

  // transform OpenAI SSE stream into plain text stream
  // that useUIStream from @json-render/react expects
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6).trim()
          if (data === "[DONE]") {
            controller.close()
            return
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: ReadonlyArray<{
                delta?: { content?: string }
              }>
            }
            const content =
              parsed.choices?.[0]?.delta?.content
            if (content) {
              controller.enqueue(encoder.encode(content))
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  })
}
