import { tool } from "ai"
import { z } from "zod/v4"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { getCurrentUser } from "@/lib/auth"
import { feedbackInterviews } from "@/db/schema"
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

// -- queryGitHub --

const queryGitHubSchema = z.object({
  queryType: z.enum([
    "commits",
    "commit_diff",
    "pull_requests",
    "issues",
    "contributors",
    "milestones",
    "repo_stats",
  ]).describe("Type of GitHub data to query"),
  sha: z
    .string()
    .optional()
    .describe("Commit SHA for commit_diff queries"),
  state: z
    .enum(["open", "closed", "all"])
    .optional()
    .describe("State filter for PRs, issues, milestones"),
  labels: z
    .string()
    .optional()
    .describe("Comma-separated labels to filter issues"),
  limit: z
    .number()
    .optional()
    .describe("Max results to return (default 10)"),
})

type QueryGitHubInput = z.infer<typeof queryGitHubSchema>

async function executeQueryGitHub(input: QueryGitHubInput) {
  const cfgResult = await getGitHubConfig()
  if (!cfgResult.success) return { error: cfgResult.error }
  const cfg = cfgResult.config

  switch (input.queryType) {
    case "commits": {
      const res = await fetchCommits(cfg, input.limit ?? 10)
      if (!res.success) return { error: res.error }
      return { data: res.data, count: res.data.length }
    }
    case "commit_diff": {
      if (!input.sha) return { error: "sha is required for commit_diff" }
      const res = await fetchCommitDiff(cfg, input.sha)
      if (!res.success) return { error: res.error }
      return { data: res.data }
    }
    case "pull_requests": {
      const res = await fetchPullRequests(
        cfg,
        input.state ?? "open",
        input.limit ?? 10,
      )
      if (!res.success) return { error: res.error }
      return { data: res.data, count: res.data.length }
    }
    case "issues": {
      const res = await fetchIssues(
        cfg,
        input.state ?? "open",
        input.labels,
        input.limit ?? 10,
      )
      if (!res.success) return { error: res.error }
      return { data: res.data, count: res.data.length }
    }
    case "contributors": {
      const res = await fetchContributors(cfg)
      if (!res.success) return { error: res.error }
      return { data: res.data, count: res.data.length }
    }
    case "milestones": {
      const res = await fetchMilestones(cfg, input.state ?? "open")
      if (!res.success) return { error: res.error }
      return { data: res.data, count: res.data.length }
    }
    case "repo_stats": {
      const res = await fetchRepoStats(cfg)
      if (!res.success) return { error: res.error }
      return { data: res.data }
    }
    default:
      return { error: "Unknown query type" }
  }
}

// -- createGitHubIssue --

const createGitHubIssueSchema = z.object({
  title: z.string().describe("Issue title"),
  body: z.string().describe("Issue body in markdown"),
  labels: z
    .array(z.string())
    .optional()
    .describe("Labels to apply"),
  assignee: z
    .string()
    .optional()
    .describe("GitHub username to assign"),
  milestone: z
    .number()
    .optional()
    .describe("Milestone number to attach to"),
})

type CreateGitHubIssueInput = z.infer<typeof createGitHubIssueSchema>

async function executeCreateGitHubIssue(
  input: CreateGitHubIssueInput,
) {
  const cfgResult = await getGitHubConfig()
  if (!cfgResult.success) return { error: cfgResult.error }

  const res = await createIssue(
    cfgResult.config,
    input.title,
    input.body,
    input.labels,
    input.assignee,
    input.milestone,
  )
  if (!res.success) return { error: res.error }
  return {
    data: {
      issueNumber: res.data.number,
      issueUrl: res.data.url,
      title: res.data.title,
    },
  }
}

// -- saveInterviewFeedback --

const interviewResponseSchema = z.object({
  question: z.string(),
  answer: z.string(),
})

const saveInterviewSchema = z.object({
  responses: z
    .array(interviewResponseSchema)
    .describe("Array of question/answer pairs from the interview"),
  summary: z
    .string()
    .describe("Brief summary of the interview findings"),
  painPoints: z
    .array(z.string())
    .optional()
    .describe("Key pain points identified"),
  featureRequests: z
    .array(z.string())
    .optional()
    .describe("Feature requests from the user"),
  overallSentiment: z
    .enum(["positive", "neutral", "negative", "mixed"])
    .describe("Overall sentiment of the feedback"),
})

type SaveInterviewInput = z.infer<typeof saveInterviewSchema>

async function executeSaveInterview(input: SaveInterviewInput) {
  const user = await getCurrentUser()
  if (!user) return { error: "Not authenticated" }

  const { env } = { env: { DB: null } }
  const db = drizzle(db)

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await db.insert(feedbackInterviews).values({
    id,
    userId: user.id,
    userName: user.displayName ?? user.email,
    userRole: user.role,
    responses: JSON.stringify(input.responses),
    summary: input.summary,
    painPoints: input.painPoints
      ? JSON.stringify(input.painPoints)
      : null,
    featureRequests: input.featureRequests
      ? JSON.stringify(input.featureRequests)
      : null,
    overallSentiment: input.overallSentiment,
    createdAt,
  })

  // try to create a github issue with the feedback
  let githubIssueUrl: string | null = null
  const cfgResult = await getGitHubConfig()
  if (cfgResult.success) {
    const title = `[UX Feedback] ${input.summary.slice(0, 60)}${input.summary.length > 60 ? "..." : ""}`
    const body = formatInterviewBody(user, input, createdAt)

    const issueRes = await createIssue(
      cfgResult.config,
      title,
      body,
      ["user-feedback"],
    )
    if (issueRes.success) {
      githubIssueUrl = issueRes.data.url
      await db
        .update(feedbackInterviews)
        .set({ githubIssueUrl })
        .where(eq(feedbackInterviews.id, id))
    }
  }

  return {
    data: { interviewId: id, githubIssueUrl },
  }
}

function formatInterviewBody(
  user: { displayName: string | null; email: string; role: string },
  input: SaveInterviewInput,
  createdAt: string,
): string {
  const qa = input.responses
    .map(
      (r, i) =>
        `### Q${i + 1}: ${r.question}\n${r.answer}`,
    )
    .join("\n\n")

  const sections = [
    `## UX Interview Feedback\n`,
    `**User:** ${user.displayName ?? user.email}`,
    `**Role:** ${user.role}`,
    `**Sentiment:** ${input.overallSentiment}`,
    `**Date:** ${createdAt}\n`,
    `## Summary\n${input.summary}\n`,
    `## Responses\n${qa}`,
  ]

  if (input.painPoints?.length) {
    sections.push(
      `\n## Pain Points\n${input.painPoints.map((p) => `- ${p}`).join("\n")}`,
    )
  }
  if (input.featureRequests?.length) {
    sections.push(
      `\n## Feature Requests\n${input.featureRequests.map((f) => `- ${f}`).join("\n")}`,
    )
  }

  return sections.join("\n")
}

// -- Export --

export const githubTools = {
  queryGitHub: tool({
    description:
      "Query GitHub repository data: commits, pull requests, " +
      "issues, contributors, milestones, or repo stats.",
    inputSchema: queryGitHubSchema,
    execute: async (input: QueryGitHubInput) =>
      executeQueryGitHub(input),
  }),

  createGitHubIssue: tool({
    description:
      "Create a new GitHub issue in the Compass repository. " +
      "Always confirm with the user before creating.",
    inputSchema: createGitHubIssueSchema,
    execute: async (input: CreateGitHubIssueInput) =>
      executeCreateGitHubIssue(input),
  }),

  saveInterviewFeedback: tool({
    description:
      "Save the results of a UX interview. Call this after " +
      "completing an interview with the user. Saves to the " +
      "database and creates a GitHub issue tagged user-feedback.",
    inputSchema: saveInterviewSchema,
    execute: async (input: SaveInterviewInput) =>
      executeSaveInterview(input),
  }),
}
