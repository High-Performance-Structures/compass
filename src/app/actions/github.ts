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
    // Try to get token from Cloudflare context or fall back to process.env for local dev
    let token: string | undefined
    try {
      const { getCloudflareContext } = await import(
        "@opennextjs/cloudflare"
      )
      const { env } = await getCloudflareContext()
      token = (env as unknown as Record<string, unknown>).GITHUB_TOKEN as string | undefined
    } catch {
      // Fallback to process.env for local development
      token = process.env.GITHUB_TOKEN
    }

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
