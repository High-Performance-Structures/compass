import { validateAgentAuth } from "@/lib/agent/api-auth"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import {
  getGitHubConfig,
  fetchCommits,
  fetchCommitDiff,
  fetchPullRequests,
  fetchIssues,
  fetchContributors,
  fetchMilestones,
  fetchRepoStats,
  createIssue,
} from "@/lib/github/client"

type GitHubAction = "query" | "createIssue"

export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<string, string>

  const auth = await validateAgentAuth(req, envRecord)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: { action: GitHubAction; [key: string]: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const cfgResult = await getGitHubConfig()
  if (!cfgResult.success) {
    return new Response(
      JSON.stringify({ error: cfgResult.error }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
  const cfg = cfgResult.config

  try {
    switch (body.action) {
      case "query": {
        const queryType = body.queryType as string
        const sha = body.sha as string | undefined
        const state = (body.state as "open" | "closed" | "all") ?? "open"
        const labels = body.labels as string | undefined
        const limit = (body.limit as number) ?? 10

        if (!queryType) {
          return new Response(
            JSON.stringify({ error: "queryType required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        switch (queryType) {
          case "commits": {
            const res = await fetchCommits(cfg, limit)
            if (!res.success) {
              return new Response(
                JSON.stringify({ error: res.error }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            return new Response(
              JSON.stringify({ data: res.data, count: res.data.length }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          }
          case "commit_diff": {
            if (!sha) {
              return new Response(
                JSON.stringify({
                  error: "sha is required for commit_diff",
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            const res = await fetchCommitDiff(cfg, sha)
            if (!res.success) {
              return new Response(
                JSON.stringify({ error: res.error }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            return new Response(
              JSON.stringify({ data: res.data }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          }
          case "pull_requests": {
            const res = await fetchPullRequests(cfg, state, limit)
            if (!res.success) {
              return new Response(
                JSON.stringify({ error: res.error }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            return new Response(
              JSON.stringify({ data: res.data, count: res.data.length }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          }
          case "issues": {
            const res = await fetchIssues(cfg, state, labels, limit)
            if (!res.success) {
              return new Response(
                JSON.stringify({ error: res.error }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            return new Response(
              JSON.stringify({ data: res.data, count: res.data.length }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          }
          case "contributors": {
            const res = await fetchContributors(cfg)
            if (!res.success) {
              return new Response(
                JSON.stringify({ error: res.error }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            return new Response(
              JSON.stringify({ data: res.data, count: res.data.length }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          }
          case "milestones": {
            const res = await fetchMilestones(cfg, state)
            if (!res.success) {
              return new Response(
                JSON.stringify({ error: res.error }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            return new Response(
              JSON.stringify({ data: res.data, count: res.data.length }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          }
          case "repo_stats": {
            const res = await fetchRepoStats(cfg)
            if (!res.success) {
              return new Response(
                JSON.stringify({ error: res.error }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            return new Response(
              JSON.stringify({ data: res.data }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          }
          default:
            return new Response(
              JSON.stringify({ error: "Unknown query type" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            )
        }
      }

      case "createIssue": {
        const title = body.title as string
        const bodyText = body.body as string
        const labels = body.labels as string[] | undefined
        const assignee = body.assignee as string | undefined
        const milestone = body.milestone as number | undefined

        if (!title || !bodyText) {
          return new Response(
            JSON.stringify({ error: "title and body required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const res = await createIssue(
          cfg,
          title,
          bodyText,
          labels,
          assignee,
          milestone,
        )
        if (!res.success) {
          return new Response(
            JSON.stringify({ error: res.error }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              issueNumber: res.data.number,
              issueUrl: res.data.url,
              title: res.data.title,
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
    }
  } catch (error) {
    console.error("GitHub endpoint error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}
