import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ProjectTodoHistory } from "@/components/projects/project-todo-history"
import { defaultRecordStatusList } from "@/lib/domain/record-statuses/rules"

describe("to-do history", () => {
  it("names archiving and restoring with the company's status labels", () => {
    const defaults = defaultRecordStatusList("todo")
    const statuses = {
      ...defaults,
      statuses: defaults.statuses.map((status) => (status.key === "archived" ? { ...status, label: "Void" } : status)),
    }
    const event = (id: string, fromStatus: string, toStatus: string) => ({
      id, kind: "status", dailyLogId: null, logDate: null, fromStatus, toStatus, note: null,
      actorName: "Pat Office", createdAt: "2026-11-12T20:00:00.000Z",
    })
    const html = renderToStaticMarkup(
      createElement(ProjectTodoHistory, {
        projectId: "p1",
        statuses,
        detail: {
          history: [event("e1", "open", "archived"), event("e2", "archived", "open")],
          hours: 0, workedLogCount: 0, finishNudgeAfterLogs: 3, costCodes: [],
        },
        finished: false,
        onMarkFinished: () => undefined,
        busy: false,
      }),
    )
    expect(html).toContain(">Void<")
    expect(html).toContain("Status · Void → Open")
    expect(html).not.toContain("Archived")
  })
})
