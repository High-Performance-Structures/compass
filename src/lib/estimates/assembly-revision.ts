import type { EstimateAssembly } from "./assemblies"

// The caller copies all lines first, including their existing assembly IDs.
// Remap with fixed-size statements to preserve current line and breakdown copying.
export function estimateAssemblyRevisionStatements(input: {
  readonly db: D1Database
  readonly projectId: string
  readonly estimateId: string
  readonly now: string
  readonly assemblies: readonly EstimateAssembly[]
}): readonly D1PreparedStatement[] {
  const copies = input.assemblies.map((assembly) => ({ assembly, id: crypto.randomUUID() }))
  return [
    ...copies.map(({ assembly, id }) => input.db.prepare(
      `INSERT INTO project_estimate_assemblies
       (id, estimate_id, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.estimateId, assembly.name, assembly.description, assembly.sortOrder, input.now, input.now)),
    ...copies.map(({ assembly, id }) => input.db.prepare(
      `UPDATE project_estimate_lines SET assembly_id = ?
       WHERE estimate_id = ? AND project_id = ? AND assembly_id = ?`
    ).bind(id, input.estimateId, input.projectId, assembly.id)),
  ]
}
