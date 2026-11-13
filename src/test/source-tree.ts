/**
 * Test helper: one cached read of the source tree for guard tests.
 *
 * Guard tests (architecture, state-machine writers, UI standards) scan every
 * file under src/. Each test used to walk and read the whole tree itself, so
 * a file with several guards read ~3,000 files several times and timed out
 * under parallel load. Vitest runs each test file in its own worker process,
 * so these caches live for one test file: the tree is listed and each file
 * read at most once there, however many tests ask.
 *
 * Paths come back exactly as `join(dir, name)` builds them from the
 * directory you pass, so callers keep their existing path format.
 */
import { readdirSync, readFileSync, type Dirent } from "node:fs"
import { join, resolve } from "node:path"

/**
 * Budget for the one-time scan in a guard file's `beforeAll`. The scan is
 * disk-bound setup, not the behaviour under test; under a loaded CI runner
 * it can take several seconds, which must not count against a test's 5 s.
 */
export const SOURCE_SCAN_TIMEOUT_MS = 60_000

const listings = new Map<string, readonly Dirent[]>()
const contents = new Map<string, string>()

function entries(dir: string): readonly Dirent[] {
  const key = resolve(dir)
  let listed = listings.get(key)
  if (!listed) {
    listed = readdirSync(key, { withFileTypes: true })
    listings.set(key, listed)
  }
  return listed
}

type SourceFileOptions = {
  /** Directory names not descended into (e.g. `__tests__`, `node_modules`). */
  readonly skipDirectories?: readonly string[]
  /** Which file names to return; every file when omitted. */
  readonly include?: RegExp
}

/** Every file below `dir`, depth first in directory order, as `join(dir, …)` paths. */
export function sourceFiles(dir: string, options: SourceFileOptions = {}): readonly string[] {
  const skip = new Set(options.skipDirectories ?? [])
  const walk = (current: string): readonly string[] =>
    entries(current).flatMap((entry) => {
      const path = join(current, entry.name)
      if (entry.isDirectory()) return skip.has(entry.name) ? [] : walk(path)
      return !options.include || options.include.test(entry.name) ? [path] : []
    })
  return walk(dir)
}

/** A file's text, read once per test file. */
export function readSource(path: string): string {
  const key = resolve(path)
  let text = contents.get(key)
  if (text === undefined) {
    text = readFileSync(key, "utf8")
    contents.set(key, text)
  }
  return text
}

/** Lists and reads every matching file below `dir` so later calls hit the cache. */
export function preloadSources(dir: string, options: SourceFileOptions = {}): void {
  for (const path of sourceFiles(dir, options)) readSource(path)
}
