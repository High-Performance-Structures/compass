export interface McpServerConfig {
  readonly name: string
  readonly transport:
    | { readonly type: "in-memory" }
    | {
        readonly type: "stdio"
        readonly command: string
        readonly args?: readonly string[]
        readonly env?: Readonly<Record<string, string>>
      }
    | {
        readonly type: "http"
        readonly url: string
        readonly headers?: Readonly<Record<string, string>>
      }
  readonly enabled: boolean
}

export interface McpClientManager {
  connect(configs: readonly McpServerConfig[]): Promise<void>

  listTools(): Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
    serverName: string
  }>

  callTool(name: string, input: unknown): Promise<string>

  disconnect(): Promise<void>
}
