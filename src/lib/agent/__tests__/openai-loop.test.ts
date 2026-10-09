import { describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"
import { createToolRegistry, runOpenAIAgent } from "agent-core"
import type { SSEData, ToolDef } from "agent-core"

// Builds an SSE body from chunk objects. `splitAt` cuts the encoded stream
// at arbitrary byte offsets to prove events split across reads still parse.
function sseResponse(
  chunks: readonly unknown[],
  splitAt: readonly number[] = [],
): Response {
  const text =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n"
  const bytes = new TextEncoder().encode(text)
  const cuts = [0, ...splitAt.filter((n) => n > 0 && n < bytes.length), bytes.length]
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < cuts.length - 1; i++) {
        controller.enqueue(bytes.slice(cuts.at(i), cuts.at(i + 1)))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

type FetchMock = Mock<typeof globalThis.fetch>

function sentBody(fetchImpl: FetchMock, call: number): unknown {
  const init = fetchImpl.mock.calls.at(call)?.[1]
  return JSON.parse(typeof init?.body === "string" ? init.body : "null")
}

async function collect(stream: AsyncGenerator<SSEData>): Promise<SSEData[]> {
  const events: SSEData[] = []
  for await (const event of stream) events.push(event)
  return events
}

const setTheme: ToolDef = {
  name: "setTheme",
  description: "Set the theme",
  input_schema: { type: "object", properties: { themeId: { type: "string" } } },
  run: vi.fn(async (input: unknown) => JSON.stringify({ success: true, input })),
}

describe("runOpenAIAgent", () => {
  it("streams a plain answer and reports usage", async () => {
    const fetchImpl: FetchMock = vi.fn(async () =>
      sseResponse([
        { choices: [{ delta: { content: "Hello " }, finish_reason: null }] },
        { choices: [{ delta: { content: "there" }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
      ]),
    )

    const events = await collect(
      runOpenAIAgent({
        apiKey: "sk-test",
        model: "gpt-test",
        systemPrompt: "You are Jarvis.",
        messages: [{ role: "user", content: "Hi" }],
        registry: createToolRegistry([], undefined),
        maxTurns: 5,
        fetchImpl,
      }),
    )

    expect(events).toEqual([
      { type: "text", content: "Hello " },
      { type: "text", content: "there" },
      {
        type: "result",
        subtype: "success",
        result: "Hello there",
        usage: { inputTokens: 12, outputTokens: 3, totalCostUsd: 0 },
      },
    ])
    const body = sentBody(fetchImpl, 0)
    expect(body).toMatchObject({
      model: "gpt-test",
      stream: true,
      messages: [
        { role: "system", content: "You are Jarvis." },
        { role: "user", content: "Hi" },
      ],
    })
    expect(body).not.toHaveProperty("tools")
  })

  it("assembles a streamed tool call, runs it, and sends the result back", async () => {
    const fetchImpl: FetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        sseResponse(
          [
            {
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: { name: "setTheme", arguments: "" },
                  }],
                },
                finish_reason: null,
              }],
            },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"themeId":' } }] }, finish_reason: null }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"midnight"}' } }] }, finish_reason: "tool_calls" }] },
          ],
          [7, 40, 95, 180],
        ),
      )
      .mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] }]),
      )

    const events = await collect(
      runOpenAIAgent({
        apiKey: "sk-test",
        model: "gpt-test",
        systemPrompt: "You are Jarvis.",
        messages: [{ role: "user", content: "Make it dark" }],
        registry: createToolRegistry([setTheme], undefined),
        maxTurns: 5,
        fetchImpl,
      }),
    )

    expect(setTheme.run).toHaveBeenCalledWith({ themeId: "midnight" })
    expect(events).toEqual([
      { type: "tool_use", name: "setTheme", toolCallId: "call_1", input: {} },
      {
        type: "tool_result",
        toolCallId: "call_1",
        output: { success: true, input: { themeId: "midnight" } },
      },
      { type: "text", content: "Done." },
      {
        type: "result",
        subtype: "success",
        result: "Done.",
        usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
      },
    ])

    const followUpBody = sentBody(fetchImpl, 1)
    expect(followUpBody).toMatchObject({
      tools: [{ type: "function", function: { name: "setTheme" } }],
      messages: [
        { role: "system" },
        { role: "user", content: "Make it dark" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "setTheme", arguments: '{"themeId":"midnight"}' },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: JSON.stringify({ success: true, input: { themeId: "midnight" } }),
        },
      ],
    })
  })

  it("surfaces OpenAI's error message instead of failing silently", async () => {
    const fetchImpl: FetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: "Incorrect API key provided", type: "invalid_request_error" } },
        { status: 401 },
      ),
    )

    const events = await collect(
      runOpenAIAgent({
        apiKey: "sk-bad",
        model: "gpt-test",
        systemPrompt: "",
        messages: [{ role: "user", content: "Hi" }],
        registry: createToolRegistry([], undefined),
        maxTurns: 5,
        fetchImpl,
      }),
    )

    expect(events).toEqual([
      { type: "error", error: "OpenAI request failed (401): Incorrect API key provided" },
    ])
  })
})

describe("createToolRegistry", () => {
  it("reports an unknown tool as an error when no MCP manager exists", async () => {
    const outcome = await createToolRegistry([], undefined).execute("nope", {})
    expect(outcome).toEqual({
      output: JSON.stringify({ error: "Unknown tool: nope" }),
      content: JSON.stringify({ error: "Unknown tool: nope" }),
      isError: true,
    })
  })

  it("turns a throwing tool into an error result", async () => {
    const failing: ToolDef = {
      name: "failing",
      description: "",
      input_schema: {},
      run: async () => {
        throw new Error("boom")
      },
    }
    const outcome = await createToolRegistry([failing], undefined).execute("failing", {})
    expect(outcome).toEqual({
      output: { error: "boom" },
      content: JSON.stringify({ error: "boom" }),
      isError: true,
    })
  })

  it("prefers a direct tool and falls back to MCP for the rest", async () => {
    const callTool = vi.fn(async () => "from-mcp")
    const registry = createToolRegistry([setTheme], {
      connect: vi.fn(),
      listTools: () => [
        { name: "setTheme", description: "dup", input_schema: {}, serverName: "compass" },
        { name: "remoteTool", description: "remote", input_schema: {}, serverName: "ext" },
      ],
      callTool,
      disconnect: vi.fn(),
    })

    expect(registry.apiTools.map((tool) => tool.name)).toEqual(["setTheme", "remoteTool"])
    expect(await registry.execute("remoteTool", { a: 1 })).toEqual({
      output: "from-mcp",
      content: "from-mcp",
      isError: false,
    })
    expect(callTool).toHaveBeenCalledWith("remoteTool", { a: 1 })
  })
})
