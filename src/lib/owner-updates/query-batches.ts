const OWNER_UPDATE_QUERY_BATCH_SIZE = 50

/**
 * D1 limits the number of values that can be bound to one statement.
 * Owner updates can legitimately include hundreds of photos, so keep each
 * ID lookup comfortably below that limit after adding other query bindings.
 */
export function ownerUpdateIdBatches(
  ids: readonly string[]
): readonly (readonly string[])[] {
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += OWNER_UPDATE_QUERY_BATCH_SIZE) {
    batches.push(ids.slice(index, index + OWNER_UPDATE_QUERY_BATCH_SIZE))
  }
  return batches
}
