
export type BridgeToolScope =
  | "read"
  | "write"
  | "admin"

export type BridgeToolRequest = Readonly<{
  tool: string
  args: Record<string, unknown>
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
