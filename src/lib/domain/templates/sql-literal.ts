/**
 * Quotes a value for the generated Buildertrend template SQL files that are
 * applied with Wrangler: NULL, a bare number, or a single-quoted string.
 */
export function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL"
  if (typeof value === "number") return String(value)
  return `'${value.replaceAll("'", "''")}'`
}
