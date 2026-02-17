import { z } from "zod"
import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const querySchema = z.object({
  queryType: z
    .enum([
      "commits",
      "commit_diff",
      "pull_requests",
      "issues",
      "contributors",
      "milestones",
      "repo_stats",
    ])
    .describe("Type of GitHub data to query"),
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

const createIssueSchema = z.object({
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

const interviewSchema = z.object({
  responses: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
      })
    )
    .describe(
      "Array of question/answer pairs from the interview"
    ),
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

export function githubTools(dataSource: DataSource): ToolDef[] {
  return [
    {
      name: "queryGitHub",
      description:
        "Query GitHub repository data: commits, pull requests, " +
        "issues, contributors, milestones, or repo stats.",
      input_schema: zodToJsonSchema(querySchema),
      run: async (input: unknown): Promise<string> => {
        const args = querySchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/github/query",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "createGitHubIssue",
      description:
        "Create a new GitHub issue in the Compass repository. " +
        "Always confirm with the user before creating.",
      input_schema: zodToJsonSchema(createIssueSchema),
      run: async (input: unknown): Promise<string> => {
        const args = createIssueSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/github/create-issue",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "saveInterviewFeedback",
      description:
        "Save the results of a UX interview. Call this after " +
        "completing an interview with the user. Saves to the " +
        "database and creates a GitHub issue tagged " +
        "user-feedback.",
      input_schema: zodToJsonSchema(interviewSchema),
      run: async (input: unknown): Promise<string> => {
        const args = interviewSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/github/save-interview",
          args
        )
        return JSON.stringify(result)
      },
    },
  ]
}
