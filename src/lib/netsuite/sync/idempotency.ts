// X-NetSuite-Idempotency-Key management.
// generates deterministic keys for push operations so
// retries don't create duplicate records in netsuite.

export function generateIdempotencyKey(
  operation: string,
  recordType: string,
  localId: string,
  timestamp?: number
): string {
  // include a time bucket (1-hour window) so the same operation
  // can be retried within the window but creates a new key after
  const bucket = Math.floor((timestamp ?? Date.now()) / 3600000)
  return `${operation}:${recordType}:${localId}:${bucket}`
}
