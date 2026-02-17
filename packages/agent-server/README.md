# Agent Server

Standalone Node.js agent server wrapping the Anthropic Agent SDK for Compass.

## Overview

This server provides an SSE (Server-Sent Events) endpoint that streams AI agent responses using the Anthropic Agent SDK. It handles authentication, session management, and tool execution via MCP (Model Context Protocol) servers.

## Environment Variables

Required:
- `AGENT_AUTH_SECRET` - HS256 JWT signing secret for authentication

Optional:
- `ANTHROPIC_API_KEY` - Direct Anthropic API key (can be overridden by user BYOK)
- `ANTHROPIC_BASE_URL` - Set to OpenRouter URL for OpenRouter mode
- `ALLOWED_ORIGINS` - Comma-separated list of allowed CORS origins (default: `http://localhost:3000`)
- `PORT` - Server port (default: `3001`)

## API Endpoints

### POST /agent/chat

Stream AI agent responses via SSE.

**Headers:**
- `Authorization: Bearer <jwt>` - Required JWT token
- `x-session-id: <uuid>` - Session identifier (optional, auto-generated if missing)
- `x-current-page: <path>` - Current page path for context
- `x-timezone: <tz>` - User timezone
- `x-user-api-key: <key>` - User's own API key (BYOK, takes priority over server key)

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" },
    { "role": "user", "content": "What can you do?" }
  ]
}
```

**Response:** SSE stream with the following event types:

```
data: {"type":"text","content":"..."}
data: {"type":"tool_use","name":"queryData","input":{...}}
data: {"type":"tool_result","name":"queryData","output":{...}}
data: {"type":"result","subtype":"success","result":"..."}
data: [DONE]
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

## JWT Token Format

The JWT must be signed with HS256 and include the following claims:

```json
{
  "userId": "user-uuid",
  "orgId": "org-uuid",
  "role": "admin|member|viewer",
  "isDemoUser": false
}
```

## Running

Development:
```bash
bun run dev
```

Production:
```bash
bun run start
```

Build:
```bash
bun run build
```

## Architecture

- `src/index.ts` - HTTP server entry point (Bun.serve)
- `src/stream.ts` - Wraps SDK query() → SSE response
- `src/auth.ts` - JWT validation (HS256)
- `src/config.ts` - Environment configuration
- `src/sessions.ts` - In-memory session store
- `src/mcp/compass-server.ts` - MCP server for Compass tools
