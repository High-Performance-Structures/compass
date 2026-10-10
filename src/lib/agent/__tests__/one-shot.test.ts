import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getProviderConfigForJwt: vi.fn(),
  modelRow: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/agent/provider-config", () => ({
  getProviderConfigForJwt: mocks.getProviderConfigForJwt,
}))

import { generateOrganizationText } from "@/lib/agent/one-shot"

// Minimal drizzle-shaped stub for the agent_config model lookup.
const db = {
  select: () => ({ from: () => ({ where: () => ({ get: mocks.modelRow }) }) }),
}

function sse(chunks: readonly unknown[]): Response {
  const text =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n"
  return new Response(text, { status: 200 })
}

const fetchMock = vi.fn<typeof globalThis.fetch>()

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getProviderConfigForJwt.mockResolvedValue(null)
  mocks.modelRow.mockResolvedValue({ modelId: "deepseek/deepseek-chat-v3.1" })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("generateOrganizationText", () => {
  it("drafts with the shared OpenAI key and OPENAI_MODEL, without tools", async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        { choices: [{ delta: { content: "Framing " }, finish_reason: null }] },
        { choices: [{ delta: { content: "is complete." }, finish_reason: "stop" }] },
      ]),
    )

    const result = await generateOrganizationText({
      // @ts-expect-error -- stub implements only the select chain used here
      db,
      env: { OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-test", OPENAI_REASONING_EFFORT: "none" },
      systemPrompt: "You write owner updates.",
      prompt: "Draft the summary.",
    })

    expect(result).toEqual({ success: true, text: "Framing is complete." })
    expect(mocks.getProviderConfigForJwt).toHaveBeenCalledWith("org_default")
    const [url, init] = fetchMock.mock.calls.at(0) ?? []
    expect(String(url)).toBe("https://api.openai.com/v1/chat/completions")
    const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "null")
    expect(body).toMatchObject({
      model: "gpt-test",
      reasoning_effort: "none",
      messages: [
        { role: "system", content: "You write owner updates." },
        { role: "user", content: "Draft the summary." },
      ],
    })
    expect(body).not.toHaveProperty("tools")
  })

  it("reports a missing provider instead of calling anything", async () => {
    const result = await generateOrganizationText({
      // @ts-expect-error -- stub implements only the select chain used here
      db,
      env: {},
      systemPrompt: "",
      prompt: "Draft the summary.",
    })

    expect(result.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("passes the provider's error through", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { message: "You have no credits remaining." } }, { status: 429 }),
    )

    const result = await generateOrganizationText({
      // @ts-expect-error -- stub implements only the select chain used here
      db,
      env: { OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-test" },
      systemPrompt: "",
      prompt: "Draft the summary.",
    })

    expect(result).toEqual({
      success: false,
      error: "OpenAI request failed (429): You have no credits remaining.",
    })
  })
})
