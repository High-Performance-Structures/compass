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
    raw(raw?: boolean): Statement
  }

  type DatabaseInstance = {
    prepare(sql: string): Statement
    exec(sql: string): void
    transaction<T>(fn: () => T): () => T
    pragma(query: string, options?: PragmaOptions): unknown
    close(): void
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
