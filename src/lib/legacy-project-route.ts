/**
 * Next's route matcher can receive an encoded colon as part of a legacy
 * Buildertrend project ID. Decode only the colon used by that ID format;
 * decoding the whole pathname could turn an encoded slash into a new route
 * segment.
 */
export function decodedLegacyProjectPathname(pathname: string): string | null {
  const decoded = pathname.replace(/%3a/gi, ":")
  return decoded === pathname ? null : decoded
}
