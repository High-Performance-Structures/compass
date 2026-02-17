import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { compassApi } from "./api-client"

export function githubTools(apiBaseUrl: string, authToken: string) {
  return [
    tool(
      "queryGitHub",
      "Query GitHub repository data: commits, pull requests, issues, contributors, milestones, or repo stats.",
      {
        queryType: z.enum([
          "commits",
          "commit_diff",
          "pull_requests",
          "issues",
          "contributors",
          "milestones",
          "repo_stats",
        ]).describe("Type of GitHub data to query"),
        sha: z.string().optional().describe("Commit SHA for commit_diff queries"),
        state: z.enum(["open", "closed", "all"]).optional().describe(
          "State filter for PRs, issues, milestones"
        ),
        labels: z.string().optional().describe("Comma-separated labels to filter issues"),
        limit: z.number().optional().describe("Max results to return (default 10)"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/github/query",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "createGitHubIssue",
      "Create a new GitHub issue in the Compass repository. Always confirm with the user before creating.",
      {
        title: z.string().describe("Issue title"),
        body: z.string().describe("Issue body in markdown"),
        labels: z.array(z.string()).optional().describe("Labels to apply"),
        assignee: z.string().optional().describe("GitHub username to assign"),
        milestone: z.number().optional().describe("Milestone number to attach to"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/github/create-issue",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "saveInterviewFeedback",
      "Save the results of a UX interview. Call this after completing an interview with the user. Saves to the database and creates a GitHub issue tagged user-feedback.",
      {
        responses: z.array(
          z.object({
            question: z.string(),
            answer: z.string(),
          })
        ).describe("Array of question/answer pairs from the interview"),
        summary: z.string().describe("Brief summary of the interview findings"),
        painPoints: z.array(z.string()).optional().describe("Key pain points identified"),
        featureRequests: z.array(z.string()).optional().describe(
          "Feature requests from the user"
        ),
        overallSentiment: z.enum([
          "positive",
          "neutral",
          "negative",
          "mixed"
        ]).describe("Overall sentiment of the feedback"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/github/save-interview",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    )
  ]
}
