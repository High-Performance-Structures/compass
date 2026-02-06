import type { ParsedSkill, SkillFrontmatter } from "./types"

type FetchResult =
  | { readonly success: true; readonly skill: ParsedSkill }
  | { readonly success: false; readonly error: string }

function parseYamlLine(
  line: string,
): readonly [string, string] | null {
  const idx = line.indexOf(":")
  if (idx < 1) return null
  const key = line.slice(0, idx).trim()
  const value = line.slice(idx + 1).trim()
  return [key, value] as const
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1)
  }
  return s
}

export function parseSkillMd(raw: string): ParsedSkill | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("---")) return null

  const endIdx = trimmed.indexOf("---", 3)
  if (endIdx < 0) return null

  const yamlBlock = trimmed.slice(3, endIdx).trim()
  const body = trimmed.slice(endIdx + 3).trim()

  const fm: Record<string, unknown> = {}

  for (const line of yamlBlock.split("\n")) {
    const parsed = parseYamlLine(line)
    if (!parsed) continue
    const [key, rawVal] = parsed
    const val = unquote(rawVal)

    const normalized = key
      .replace(/-/g, "")
      .replace(/_/g, "")
      .toLowerCase()

    switch (normalized) {
      case "name":
        fm.name = val
        break
      case "description":
        fm.description = val
        break
      case "allowedtools":
        fm.allowedTools = val
        break
      case "userinvocable":
        fm.userInvocable = val === "true"
        break
      default:
        if (!fm.metadata) fm.metadata = {}
        ;(fm.metadata as Record<string, unknown>)[key] = val
        break
    }
  }

  if (typeof fm.name !== "string" || fm.name.length === 0) {
    return null
  }
  if (typeof fm.description !== "string") {
    fm.description = ""
  }

  return {
    frontmatter: fm as unknown as SkillFrontmatter,
    body,
  }
}

function parseSource(source: string): {
  readonly owner: string
  readonly repo: string
  readonly path: string | null
} {
  const parts = source.split("/").filter(Boolean)
  if (parts.length < 2) {
    return { owner: "", repo: "", path: null }
  }
  const owner = parts[0]
  const repo = parts[1]
  const path = parts.length > 2
    ? parts.slice(2).join("/")
    : null
  return { owner, repo, path }
}

function buildUrls(
  owner: string,
  repo: string,
  path: string | null,
): ReadonlyArray<string> {
  const base = "https://raw.githubusercontent.com"
  const urls: Array<string> = []

  if (path) {
    urls.push(`${base}/${owner}/${repo}/main/${path}/SKILL.md`)
    urls.push(
      `${base}/${owner}/${repo}/main/skills/${path}/SKILL.md`,
    )
  } else {
    urls.push(`${base}/${owner}/${repo}/main/SKILL.md`)
    urls.push(`${base}/${owner}/${repo}/main/skills/SKILL.md`)
  }

  return urls
}

export async function fetchSkillFromGitHub(
  source: string,
): Promise<FetchResult> {
  const { owner, repo, path } = parseSource(source)

  if (!owner || !repo) {
    return {
      success: false,
      error:
        "invalid source format. use owner/repo or " +
        "owner/repo/skill-name",
    }
  }

  const urls = buildUrls(owner, repo, path)

  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue

      const raw = await res.text()
      const skill = parseSkillMd(raw)
      if (!skill) continue

      return { success: true, skill }
    } catch {
      continue
    }
  }

  return {
    success: false,
    error: `could not find SKILL.md at ${source}. tried: ${urls.join(", ")}`,
  }
}
