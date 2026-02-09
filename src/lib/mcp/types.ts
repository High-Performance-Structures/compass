// Wire protocol types for the MCP bridge WebSocket connection

// --- Client → Server messages ---

export type BridgeAuthMessage = Readonly<{
  type: "auth"
  compassUrl: string
  apiKey: string
}>

export type BridgeChatSend = Readonly<{
  type: "chat.send"
  id: string
  messages: ReadonlyArray<unknown>
  context: Readonly<{
    currentPage: string
    timezone: string
    conversationId: string
  }>
}>

export type BridgeChatAbort = Readonly<{
  type: "chat.abort"
  runId: string
}>

export type BridgePing = Readonly<{
  type: "ping"
}>

// --- Server → Client messages ---

export type BridgeAuthOk = Readonly<{
  type: "auth_ok"
  user: Readonly<{
    id: string
    name: string
    role: string
  }>
}>

export type BridgeAuthError = Readonly<{
  type: "auth_error"
  message: string
}>

export type BridgeChatAck = Readonly<{
  type: "chat.ack"
  id: string
  runId: string
}>

export type BridgeChunk = Readonly<{
  type: "chunk"
  runId: string
  chunk: unknown
}>

export type BridgeChatDone = Readonly<{
  type: "chat.done"
  runId: string
}>

export type BridgeChatError = Readonly<{
  type: "chat.error"
  runId: string
  error: string
}>

export type BridgePong = Readonly<{
  type: "pong"
}>

// --- Unions ---

export type BridgeClientMessage =
  | BridgeAuthMessage
  | BridgeChatSend
  | BridgeChatAbort
  | BridgePing

export type BridgeServerMessage =
  | BridgeAuthOk
  | BridgeAuthError
  | BridgeChatAck
  | BridgeChunk
  | BridgeChatDone
  | BridgeChatError
  | BridgePong

export type BridgeMessage =
  | BridgeClientMessage
  | BridgeServerMessage

// --- Tool types ---

export const BRIDGE_TOOL_SCOPES = [
  "read",
  "write",
  "admin",
] as const

export type BridgeToolScope =
  (typeof BRIDGE_TOOL_SCOPES)[number]

export type BridgeToolRequest = Readonly<{
  tool: string
  args: Record<string, unknown>
}>

export type BridgeToolResponse = Readonly<{
  success: boolean
  result?: unknown
  error?: string
}>

export type BridgeToolMeta = Readonly<{
  name: string
  description: string
  scope: BridgeToolScope
}>

// --- Registration / context responses ---

export type BridgeRegisterResponse = Readonly<{
  user: Readonly<{
    id: string
    name: string
    email: string
    role: string
  }>
  tools: ReadonlyArray<BridgeToolMeta>
  memories: ReadonlyArray<unknown>
  dashboards: ReadonlyArray<unknown>
  skills: ReadonlyArray<unknown>
}>

export type BridgeContextResponse = Readonly<{
  memories: ReadonlyArray<unknown>
  dashboards: ReadonlyArray<unknown>
  skills: ReadonlyArray<unknown>
}>
