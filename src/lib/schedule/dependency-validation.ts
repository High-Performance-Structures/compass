import type { TaskDependencyData } from "./types"

export function wouldCreateCycle(
  existingDeps: TaskDependencyData[],
  newPredecessorId: string,
  newSuccessorId: string
): boolean {
  if (newPredecessorId === newSuccessorId) return true

  // build adjacency list from existing deps
  const adjacency = new Map<string, Set<string>>()
  for (const dep of existingDeps) {
    if (!adjacency.has(dep.predecessorId)) {
      adjacency.set(dep.predecessorId, new Set())
    }
    adjacency.get(dep.predecessorId)!.add(dep.successorId)
  }

  // add proposed edge
  if (!adjacency.has(newPredecessorId)) {
    adjacency.set(newPredecessorId, new Set())
  }
  adjacency.get(newPredecessorId)!.add(newSuccessorId)

  // DFS from successor to see if we can reach predecessor
  const visited = new Set<string>()
  const stack = [newSuccessorId]

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === newPredecessorId) return true
    if (visited.has(current)) continue
    visited.add(current)

    const neighbors = adjacency.get(current)
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor)
        }
      }
    }
  }

  return false
}

export function wouldDependencyUpdateCreateCycle(
  existingDependencies: readonly TaskDependencyData[],
  dependencyId: string,
  predecessorId: string,
  successorId: string
): boolean {
  return wouldCreateCycle(
    existingDependencies.filter(
      (dependency) => dependency.id !== dependencyId
    ),
    predecessorId,
    successorId
  )
}
