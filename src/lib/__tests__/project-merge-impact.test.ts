import { describe, expect, it } from "vitest"

import {
  projectDeletionDependencyTableNames,
  projectMergeCategoryForTable,
  projectMergeDependencyTableNames,
  summarizeProjectMergeImpact,
} from "@/lib/project-merge-impact"

describe("project merge impact", () => {
  it("includes custom project links when checking permanent deletion", () => {
    expect(projectDeletionDependencyTableNames([{ name: "project_external_links", sql: "CREATE TABLE project_external_links(project_id text)" }, { name: "project_members", sql: "CREATE TABLE project_members(project_id text)" }])).toEqual(["project_external_links", "project_members"])
  })
  it("discovers safe tables with an exact project_id column", () => {
    expect(
      projectMergeDependencyTableNames([
        {
          name: "project_documents",
          sql: "CREATE TABLE `project_documents` (`project_id` text NOT NULL)",
        },
        {
          name: "project_duplicate_decisions",
          sql: "CREATE TABLE `project_duplicate_decisions` (`kept_project_id` text)",
        },
        {
          name: "project_correspondence",
          sql: "CREATE TABLE project_correspondence (project_id TEXT NOT NULL)",
        },
        {
          name: "project_members",
          sql: "CREATE TABLE `project_members` (`project_id` text NOT NULL)",
        },
        {
          name: "unsafe-name;drop",
          sql: "CREATE TABLE `unsafe-name;drop` (`project_id` text)",
        },
      ]),
    ).toEqual(["project_correspondence", "project_documents"])
  })

  it("groups linked records into user-facing categories", () => {
    expect(projectMergeCategoryForTable("project_documents")).toBe("documents")
    expect(projectMergeCategoryForTable("daily_logs")).toBe("activity")
    expect(projectMergeCategoryForTable("schedule_tasks")).toBe("planning")
    expect(projectMergeCategoryForTable("project_estimates")).toBe("financial")
    expect(projectMergeCategoryForTable("project_contacts")).toBe("access")

    expect(
      summarizeProjectMergeImpact([
        { tableName: "project_documents", recordCount: 3 },
        { tableName: "daily_logs", recordCount: 2 },
        { tableName: "schedule_tasks", recordCount: 4 },
        { tableName: "project_estimates", recordCount: 1 },
        { tableName: "empty_table", recordCount: 0 },
      ]),
    ).toEqual({
      totalRecordCount: 10,
      categories: [
        { id: "documents", label: "Documents and media", recordCount: 3 },
        { id: "activity", label: "Activity and communication", recordCount: 2 },
        { id: "planning", label: "Schedule and project records", recordCount: 4 },
        { id: "financial", label: "Estimates and financial records", recordCount: 1 },
      ],
    })
  })
})
