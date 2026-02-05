export const dynamic = "force-dynamic"

import { DashboardChat } from "@/components/dashboard-chat"

type RepoStats = {
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  subscribers_count: number
}

const REPO = "High-Performance-Structures/compass"

async function getRepoStats(): Promise<RepoStats | null> {
  try {
    const { getCloudflareContext } = await import(
      "@opennextjs/cloudflare"
    )
    const { env } = await getCloudflareContext()
    const token = (env as unknown as Record<string, unknown>)
      .GITHUB_TOKEN as string | undefined

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "compass-dashboard",
    }
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(
      `https://api.github.com/repos/${REPO}`,
      { next: { revalidate: 300 }, headers }
    )
    if (!res.ok) return null
    return (await res.json()) as RepoStats
  } catch {
    return null
  }
}

export default async function Page() {
  const stats = await getRepoStats()

  return <DashboardChat stats={stats} />
}
