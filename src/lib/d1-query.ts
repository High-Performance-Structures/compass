const D1_VALUE_CHUNK_SIZE = 50

/** Keeps dynamic IN predicates below D1's 100-bound-parameter limit. */
export function chunkD1Values<T>(values: readonly T[]): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += D1_VALUE_CHUNK_SIZE) {
    chunks.push(values.slice(index, index + D1_VALUE_CHUNK_SIZE))
  }
  return chunks
}
