import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { scheduleTasks } from "@/db/schema"

describe("schedule task notes schema", () => {
  it("persists notes on schedule tasks with an additive migration", async () => {
    expect(scheduleTasks.notes.name).toBe("notes")

    const migration = await readFile(
      resolve(process.cwd(), "drizzle/0159_schedule_task_notes.sql"),
      "utf8"
    )
    expect(migration.trim()).toBe(
      "ALTER TABLE `schedule_tasks` ADD `notes` text;"
    )
  })
})
