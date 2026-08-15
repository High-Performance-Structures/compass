export function selectedOwnerUpdateResourceIdsForViewer(input: {
  readonly isInternal: boolean
  readonly grantedResourceIds: readonly string[]
  readonly selectedResourceIds: readonly string[]
}): readonly string[] {
  if (input.isInternal) return input.selectedResourceIds
  const granted = new Set(input.grantedResourceIds)
  return input.selectedResourceIds.filter((resourceId) => granted.has(resourceId))
}
