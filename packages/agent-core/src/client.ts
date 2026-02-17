import Anthropic from "@anthropic-ai/sdk"
import type { ProviderConfig } from "./types"

export function createClient(provider: ProviderConfig): Anthropic {
  switch (provider.type) {
    case "anthropic": {
      // OAuth tokens use Bearer auth instead of x-api-key
      if (provider.apiKey?.startsWith("sk-ant-oat")) {
        const oauthToken = provider.apiKey
        const wrappedFetch: typeof globalThis.fetch = (input, init) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url
          const betaUrl = url.includes("?")
            ? `${url}&beta=true`
            : `${url}?beta=true`
          const existingHeaders =
            (init?.headers as Record<string, string> | undefined) ?? {}
          // Remove x-api-key if SDK sets it, add Bearer
          const { "x-api-key": _dropped, ...rest } = existingHeaders
          return globalThis.fetch(betaUrl, {
            ...init,
            headers: {
              ...rest,
              authorization: `Bearer ${oauthToken}`,
              "anthropic-beta":
                "oauth-2025-04-20,interleaved-thinking-2025-05-14",
            },
          })
        }
        return new Anthropic({ apiKey: "unused", fetch: wrappedFetch })
      }
      return new Anthropic({
        apiKey: provider.apiKey,
        ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
      })
    }
    case "openrouter":
      return new Anthropic({
        apiKey: provider.apiKey ?? "",
        baseURL: "https://openrouter.ai/api",
      })
    case "ollama":
      return new Anthropic({
        apiKey: "ollama",
        baseURL: provider.baseUrl ?? "http://localhost:11434",
      })
    case "custom":
      return new Anthropic({
        apiKey: provider.apiKey ?? "",
        ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
      })
  }
}
