#!/usr/bin/env bun

// diagnostic: test OAuth token with raw fetch
// exactly matching opencode-anthropic-auth plugin behavior

import { loadConfig } from "./config"

const config = await loadConfig()

console.log("=== compass-bridge auth diagnostic ===\n")

// check what auth is available
const envKey = process.env.ANTHROPIC_API_KEY
console.log(
    `env ANTHROPIC_API_KEY: ${envKey ? "set" : "not set"}`,
)
console.log(
    `config.anthropicApiKey: ${config.anthropicApiKey ? "set" : "not set"}`,
)
console.log(
    `config.oauthCredentials: ${config.oauthCredentials ? "set" : "not set"}`,
)

if (config.oauthCredentials) {
    const oauth = config.oauthCredentials
    const expired =
        Date.now() > oauth.expires
    console.log(
        `  access: ${oauth.access.slice(0, 20)}...`,
    )
    console.log(
        `  refresh: ${oauth.refresh ? "set" : "not set"}`,
    )
    console.log(
        `  expires: ${new Date(oauth.expires).toISOString()}`,
    )
    console.log(`  expired: ${expired}`)
}

// try raw fetch exactly matching opencode plugin
const token = config.oauthCredentials?.access
if (!token) {
    console.error(
        "\nno OAuth credentials found. run 'compass-bridge login' first.",
    )
    process.exit(1)
}

console.log("\n--- test 1: raw fetch to /v1/messages?beta=true ---\n")

const body = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 100,
    system: [
        {
            type: "text",
            text: "You are Claude Code, Anthropic's official CLI for Claude.",
        },
    ],
    messages: [
        {
            role: "user",
            content: "Say hello in exactly 3 words.",
        },
    ],
    tools: [
        {
            name: "mcp_testTool",
            description: "A test tool",
            input_schema: {
                type: "object",
                properties: {},
            },
        },
    ],
})

const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    authorization: `Bearer ${token}`,
    "anthropic-beta":
        "oauth-2025-04-20,interleaved-thinking-2025-05-14",
    "user-agent": "compass-bridge/1.0",
}

console.log("request headers:")
for (const [k, v] of Object.entries(headers)) {
    if (k === "authorization") {
        console.log(`  ${k}: Bearer ${token.slice(0, 20)}...`)
    } else {
        console.log(`  ${k}: ${v}`)
    }
}

console.log(`\nrequest URL: https://api.anthropic.com/v1/messages?beta=true`)
console.log(`request body model: claude-sonnet-4-5-20250929`)

try {
    const res = await fetch(
        "https://api.anthropic.com/v1/messages?beta=true",
        {
            method: "POST",
            headers,
            body,
        },
    )

    console.log(`\nresponse status: ${res.status}`)
    const text = await res.text()
    console.log(`response body: ${text.slice(0, 500)}`)

    if (res.ok) {
        console.log("\n SUCCESS -- token works with raw fetch!")
    } else {
        console.log("\n FAILED -- token rejected by Anthropic")

        // try without ?beta=true
        console.log(
            "\n--- test 2: without ?beta=true ---\n",
        )
        const res2 = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
                method: "POST",
                headers,
                body,
            },
        )
        console.log(`response status: ${res2.status}`)
        const text2 = await res2.text()
        console.log(`response body: ${text2.slice(0, 500)}`)

        // try with x-api-key instead of Bearer
        console.log(
            "\n--- test 3: with x-api-key instead of Bearer ---\n",
        )
        const headers3 = { ...headers }
        delete headers3.authorization
        headers3["x-api-key"] = token
        const res3 = await fetch(
            "https://api.anthropic.com/v1/messages?beta=true",
            {
                method: "POST",
                headers: headers3,
                body,
            },
        )
        console.log(`response status: ${res3.status}`)
        const text3 = await res3.text()
        console.log(`response body: ${text3.slice(0, 500)}`)
    }
} catch (err) {
    console.error("fetch error:", err)
}
