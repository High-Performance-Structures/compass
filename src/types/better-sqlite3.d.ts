declare module "better-sqlite3" {
  type RunResult = {
    changes: number
    lastInsertRowid: number | bigint
  }

  type PragmaOptions = {
    simple?: boolean
  }

  type Options = {
    readonly?: boolean
    fileMustExist?: boolean
    timeout?: number
    verbose?: (message: unknown) => void
  }

  type Statement = {
    run(...params: unknown[]): RunResult
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    iterate(...params: unknown[]): IterableIterator<unknown>
    bind(...params: unknown[]): Statement
  }

  type DatabaseInstance = {
    prepare(sql: string): Statement
    transaction<T>(fn: () => T): () => T
    pragma(query: string, options?: PragmaOptions): unknown
    close(): void
    open(): void
    readonly name: string
    readonly open: boolean
    readonly readonly: boolean
    readonly memory: boolean
  }

  type DatabaseConstructor = {
    new (filename: string, options?: Options): DatabaseInstance
    new (buffer: Buffer | Uint8Array, options?: Options): DatabaseInstance
    (filename: string, options?: Options): DatabaseInstance
    (buffer: Buffer | Uint8Array, options?: Options): DatabaseInstance
  }

  const Database: DatabaseConstructor
  export default Database
}
