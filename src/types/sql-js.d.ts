declare module "sql.js" {
    export type SqlValue = string | number | Uint8Array | null

    export interface QueryExecResult {
        readonly columns: readonly string[]
        readonly values: readonly (readonly SqlValue[])[]
    }

    export interface Statement {
        bind(values?: readonly SqlValue[]): boolean
        step(): boolean
        getAsObject(): Record<string, SqlValue>
        free(): void
    }

    export interface Database {
        prepare(query: string): Statement
        run(query: string, params?: readonly SqlValue[]): void
        exec(query: string, params?: readonly SqlValue[]): QueryExecResult[]
        export(): Uint8Array
        getRowsModified(): number
    }

    export interface SqlJsStatic {
        readonly Database: {
            new (data?: BufferSource): Database
        }
    }

    export default function initSqlJs(config?: {
        locateFile?: (file: string) => string
    }): Promise<SqlJsStatic>
}
