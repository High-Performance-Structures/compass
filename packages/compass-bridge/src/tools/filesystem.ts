// local filesystem tools -- give claude access to the user's machine

import { readFile, writeFile, readdir, stat } from "fs/promises"
import { existsSync } from "fs"
import { join, resolve } from "path"
import { Glob } from "bun"

export async function readLocalFile(
  path: string,
): Promise<{ content: string } | { error: string }> {
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    return { error: `file not found: ${resolved}` }
  }

  try {
    const content = await readFile(resolved, "utf-8")
    return { content }
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : "unknown error"
    return { error: `failed to read: ${msg}` }
  }
}

export async function writeLocalFile(
  path: string,
  content: string,
): Promise<{ success: true } | { error: string }> {
  const resolved = resolve(path)

  try {
    await writeFile(resolved, content, "utf-8")
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : "unknown error"
    return { error: `failed to write: ${msg}` }
  }
}

export async function listLocalDirectory(
  path: string,
): Promise<
  | { entries: ReadonlyArray<{ name: string; type: string }> }
  | { error: string }
> {
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    return { error: `directory not found: ${resolved}` }
  }

  try {
    const entries = await readdir(resolved, {
      withFileTypes: true,
    })
    return {
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      })),
    }
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : "unknown error"
    return { error: `failed to list: ${msg}` }
  }
}

export async function searchLocalFiles(
  directory: string,
  pattern: string,
  maxResults = 50,
): Promise<
  | { files: ReadonlyArray<string> }
  | { error: string }
> {
  const resolved = resolve(directory)
  if (!existsSync(resolved)) {
    return { error: `directory not found: ${resolved}` }
  }

  try {
    const glob = new Glob(pattern)
    const matches: string[] = []
    for await (const file of glob.scan({
      cwd: resolved,
      absolute: true,
    })) {
      matches.push(file)
      if (matches.length >= maxResults) break
    }
    return { files: matches }
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : "unknown error"
    return { error: `search failed: ${msg}` }
  }
}
