import Anthropic from "@anthropic-ai/sdk"
import type { ProviderConfig } from "./types"

export function createClient(provider: ProviderConfig): Anthropic {
  switch (provider.type) {
    case "anthropic":
      return new Anthropic({
        apiKey: provider.apiKey,
        ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
      })
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
