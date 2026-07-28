import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  feedbackDeskItems,
  type FeedbackDeskItem,
} from "@/db/schema-jarvis"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"
import {
  GITHUB_FEEDBACK_PROJECT_TITLE,
  githubFeedbackIssueContent,
} from "@/lib/jarvis/feedback-github-content"

type CompassDb = ReturnType<typeof getDb>

type GitHubFeedbackConfig = Readonly<{
  token: string
  repo: string
  projectId: string | null
}>

type GitHubIssueResponse = Readonly<{
  html_url?: unknown
  node_id?: unknown
}>

type GraphqlResponse = Readonly<{
  errors?: ReadonlyArray<Readonly<{ message?: unknown }>>
  data?: Readonly<{
    viewer?: Readonly<{
      projectsV2?: Readonly<{
        nodes?: ReadonlyArray<Readonly<{ id?: unknown; title?: unknown }>>
      }>
    }>
  }>
}>

function githubConfig(env: CloudflareEnv): GitHubFeedbackConfig | null {
  const token = getJarvisEnvValue(env, "GITHUB_TOKEN")
  const repo = getJarvisEnvValue(env, "GITHUB_REPO")
  if (!token || !repo) return null

  return {
    token,
    repo,
    projectId: getJarvisEnvValue(env, "GITHUB_FEEDBACK_PROJECT_ID"),
  }
}

function githubHeaders(token: string): Readonly<Record<string, string>> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "compass-feedback-desk",
  }
}

async function githubGraphql(
  config: GitHubFeedbackConfig,
  query: string,
  variables: Readonly<Record<string, string | number>>,
): Promise<GraphqlResponse | null> {
  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: githubHeaders(config.token),
      body: JSON.stringify({ query, variables }),
    })
    if (!response.ok) return null
    return await response.json() as GraphqlResponse
  } catch {
    return null
  }
}

async function feedbackProjectId(
  config: GitHubFeedbackConfig,
): Promise<string | null> {
  if (config.projectId) return config.projectId

  const result = await githubGraphql(
    config,
    `query FeedbackProject($first: Int!) {
      viewer {
        projectsV2(first: $first) { nodes { id title } }
      }
    }`,
    { first: 100 },
  )
  const projects = result?.data?.viewer?.projectsV2?.nodes ?? []
  const matchingProject = projects.find(
    (project) => project.title === GITHUB_FEEDBACK_PROJECT_TITLE,
  )
  return typeof matchingProject?.id === "string"
    ? matchingProject.id
    : null
}

async function addIssueToFeedbackProject(
  config: GitHubFeedbackConfig,
  issueNodeId: string,
): Promise<void> {
  const projectId = await feedbackProjectId(config)
  if (!projectId) {
    console.error("feedback_github_project_not_found", {
      projectTitle: GITHUB_FEEDBACK_PROJECT_TITLE,
    })
    return
  }

  const result = await githubGraphql(
    config,
    `mutation AddFeedbackIssue($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`,
    { projectId, contentId: issueNodeId },
  )
  if (result?.errors?.length || !result?.data) {
    console.error("feedback_github_project_add_failed", {
      error:
        typeof result?.errors?.[0]?.message === "string"
          ? result.errors[0].message
          : "GitHub Project mutation did not return data",
    })
  }
}

export async function linkFeedbackDeskItemToGithub(
  db: CompassDb,
  env: CloudflareEnv,
  item: FeedbackDeskItem,
): Promise<string | null> {
  const config = githubConfig(env)
  if (!config) return null

  if (item.githubIssueUrl) {
    if (item.githubIssueNodeId) {
      await addIssueToFeedbackProject(config, item.githubIssueNodeId)
    }
    return item.githubIssueUrl
  }

  const issueContent = githubFeedbackIssueContent(item)
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.repo}/issues`,
      {
        method: "POST",
        headers: githubHeaders(config.token),
        body: JSON.stringify(issueContent),
      },
    )
    if (!response.ok) {
      console.error("feedback_github_issue_failed", {
        feedbackDeskItemId: item.id,
        status: response.status,
      })
      return null
    }
    const issue = await response.json() as GitHubIssueResponse
    if (typeof issue.html_url !== "string") return null

    await db
      .update(feedbackDeskItems)
      .set({
        githubIssueUrl: issue.html_url,
        githubIssueNodeId:
          typeof issue.node_id === "string" ? issue.node_id : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(feedbackDeskItems.id, item.id))

    if (typeof issue.node_id === "string") {
      await addIssueToFeedbackProject(config, issue.node_id)
    }
    return issue.html_url
  } catch (error) {
    console.error("feedback_github_issue_failed", {
      feedbackDeskItemId: item.id,
      error: error instanceof Error ? error.message : "Unknown error",
    })
    return null
  }
}
