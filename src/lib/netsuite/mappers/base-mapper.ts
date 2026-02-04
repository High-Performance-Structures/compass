// abstract mapper interface for bidirectional field mapping
// between local (compass D1) records and netsuite records.

export interface FieldMapping<Local, Remote> {
  toRemote(local: Local): Partial<Remote>
  toLocal(remote: Remote): Partial<Local>
  getNetSuiteRecordType(): string
  getLocalTable(): string
  getSuiteQLFields(): string[]
  getLastModifiedField(): string
}

export abstract class BaseMapper<
  Local extends Record<string, unknown>,
  Remote extends Record<string, unknown>,
> implements FieldMapping<Local, Remote> {
  abstract toRemote(local: Local): Partial<Remote>
  abstract toLocal(remote: Remote): Partial<Local>
  abstract getNetSuiteRecordType(): string
  abstract getLocalTable(): string

  getSuiteQLFields(): string[] {
    return ["id", "lastmodifieddate"]
  }

  getLastModifiedField(): string {
    return "lastmodifieddate"
  }

  // build a SuiteQL SELECT for this entity
  buildSelectQuery(
    additionalWhere?: string,
    limit?: number,
    offset?: number
  ): string {
    const fields = this.getSuiteQLFields().join(", ")
    const table = this.getNetSuiteRecordType()
    let sql = `SELECT ${fields} FROM ${table}`

    if (additionalWhere) {
      sql += ` WHERE ${additionalWhere}`
    }

    if (limit) sql += ` FETCH NEXT ${limit} ROWS ONLY`
    if (offset) sql += ` OFFSET ${offset} ROWS`

    return sql
  }

  // build a delta query filtered by last modified date
  buildDeltaQuery(since: string): string {
    const lastMod = this.getLastModifiedField()
    return this.buildSelectQuery(
      `${lastMod} > '${since}'`
    )
  }
}
