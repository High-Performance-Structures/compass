import { compareEstimateLineOrder } from "@/lib/estimates/line-order"

export type EstimateAssembly = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly sortOrder: number
}

type AssemblyLine = {
  readonly id: string
  readonly costCode: string
  readonly assemblyId: string | null
  readonly sortOrder: number
  readonly lineTotalCents: number
}

export type EstimateAssemblyGroup<T> = {
  readonly id: string | null
  readonly name: string
  readonly description: string | null
  readonly subtotalCents: number
  readonly lines: readonly T[]
}

// Each estimate line belongs to at most one assembly. Unassigned or orphaned
// items remain visible so grouping cannot silently omit costs.
export function groupEstimateAssemblies<T extends AssemblyLine>(
  assemblies: readonly EstimateAssembly[],
  lines: readonly T[]
): readonly EstimateAssemblyGroup<T>[] {
  const buckets = new Map<string | null, T[]>([[null, []]])
  for (const assembly of assemblies) buckets.set(assembly.id, [])
  for (const line of [...lines].sort(compareEstimateLineOrder)) {
    const bucket = buckets.get(line.assemblyId) ?? buckets.get(null)
    if (bucket) bucket.push(line)
  }
  const definitions = [
    ...[...assemblies].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    { id: null, name: "Other work", description: null },
  ]
  return definitions.map((assembly) => {
    const items = buckets.get(assembly.id) ?? []
    return {
      ...assembly,
      subtotalCents: items.reduce((sum, line) => sum + line.lineTotalCents, 0),
      lines: items,
    }
  }).filter((group) => group.id !== null || group.lines.length > 0)
}
