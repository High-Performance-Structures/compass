"use server"

const REPO = "High-Performance-Structures/compass"

interface RepoStats {
  readonly stargazers_count: number
  readonly forks_count: number
  readonly open_issues_count: number
  readonly subscribers_count: number
}

export async function getRepoStats(): Promise<RepoStats | null> {
  try {
    const { getCloudflareContext } = await import(
      "@opennextjs/cloudflare"
    )
    const { env } = await getCloudflareContext()
    const token = (
      env as unknown as Record<string, unknown>
    ).GITHUB_TOKEN as string | undefined

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "compass-dashboard",
    }
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(
      `https://api.github.com/repos/${REPO}`,
      { headers }
    )
    if (!res.ok) return null

    const data = (await res.json()) as Record<string, unknown>
    return {
      stargazers_count: data.stargazers_count as number,
      forks_count: data.forks_count as number,
      open_issues_count: data.open_issues_count as number,
      subscribers_count: data.subscribers_count as number,
    }
  } catch {
    return null
  }
}
