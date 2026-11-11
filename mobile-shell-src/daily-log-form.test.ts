import { describe, expect, it } from "vitest"

import {
  addWorkLine,
  costCodeOptions,
  emptyLogDraft,
  errorControlId,
  filledWorkLines,
  localDateInputValue,
  logDraftSchema,
  logFieldsHtml,
  logRequirements,
  removeWorkLine,
  saveButtonLabel,
  updateLogDraft,
} from "./daily-log-form"
import { fieldOutboxSchema, fieldProjectPacketSchema } from "../src/lib/field/types"
import { followUpsFromDraft } from "../src/lib/daily-logs/log-followups"
import { emptyFollowUpDraft, followUpAction, installedSelectionsHtml, storedFollowUpDraft } from "./daily-log-followups"

const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
const form = {
  costCodes: [{ code: "01 71 13", name: "Mobilization", label: "01 71 13 Mobilization", group: "" }],
  requirements: { requireCostCodeTime: true, requiredFields: ["crewPresent" as const] },
  followUps: null,
}

describe("Field Mode daily log draft", () => {
  it("browses all approved packet codes, including additions, and searches only that list", () => {
    for (const group of ["", "Customized duty codes"]) {
      const setup = { ...form, costCodes: [
        { code: "01 71 13", name: "Mobilization", label: "01 71 13 Mobilization", group },
        { code: "48 14 00", name: "Solar", label: "48 14 00 Solar", group: "Project additions" },
      ] }
      expect(costCodeOptions(setup, "", escape)).toContain("01 71 13")
      expect(costCodeOptions(setup, "", escape)).toContain("48 14 00")
      expect(costCodeOptions(setup, "", escape, "unapproved")).not.toContain("48 14 00")
      expect(costCodeOptions(setup, "", escape, "solar")).toContain("48 14 00")
      expect(costCodeOptions(setup, "48 14 00", escape)).toContain('value="48 14 00" selected')
    }
  })

  it("retains per-line company search through draft reloads and form redraws", () => {
    let draft = updateLogDraft(emptyLogDraft("2026-10-26"), "workLines.0.costCodeSearch", "solar")
    draft = updateLogDraft(draft, "workLines.0.costCode", "48 14 00")
    draft = addWorkLine(draft)
    draft = updateLogDraft(draft, "workLines.1.costCodeSearch", "mobilization")
    draft = logDraftSchema.parse(JSON.parse(JSON.stringify(removeWorkLine(draft, 0))))
    expect(draft.workLines[0]?.costCodeSearch).toBe("mobilization")
    expect(logFieldsHtml({ draft, form, errors: new Map(), escape })).toContain('value="mobilization" data-cost-code-search="0"')
    draft = updateLogDraft(draft, "workLines.0.hours", "1")
    expect(filledWorkLines(draft.workLines)[0]).not.toHaveProperty("costCodeSearch")
  })

  it("keeps typed values by control name, including line parts", () => {
    let draft = emptyLogDraft("2026-10-13")
    draft = updateLogDraft(draft, "workCompleted", "Poured footing")
    draft = updateLogDraft(draft, "workLines.0.hours", "3")
    draft = addWorkLine(draft)
    draft = updateLogDraft(draft, "workLines.1.costCode", "01 71 13")
    draft = updateLogDraft(draft, "unknown", "ignored")
    expect(draft.workCompleted).toBe("Poured footing")
    expect(draft.workLines).toEqual([
      { costCode: "", hours: "3", description: "" },
      { costCode: "01 71 13", hours: "", description: "" },
    ])
    expect(filledWorkLines(removeWorkLine(draft, 0).workLines)).toHaveLength(1)
    expect(removeWorkLine(removeWorkLine(draft, 0), 0).workLines).toHaveLength(1)
  })

  it("uses the phone's local date, not UTC", () => {
    expect(localDateInputValue(new Date(2026, 9, 13, 23, 30))).toBe("2026-10-13")
  })

  it("only requires a cost code when the phone has the list", () => {
    expect(logRequirements(null).requireCostCodeTime).toBe(false)
    expect(logRequirements({ ...form, costCodes: [] }).requireCostCodeTime).toBe(false)
    expect(logRequirements(form).requireCostCodeTime).toBe(true)
  })

  it("renders typed values, required marks and errors", () => {
    const draft = updateLogDraft(emptyLogDraft("2026-10-13"), "workCompleted", 'Set "A" <forms>')
    const html = logFieldsHtml({ draft, form, errors: new Map([["crewPresent", "Who was on site is required."]]), escape })
    expect(html).toContain("Set &quot;A&quot; &lt;forms>")
    expect(html).toContain("Who was on site<span class=\"required-tag\">Required</span>")
    expect(html).toContain('id="log-crewPresent" name="crewPresent"')
    expect(html).toContain("1 required item needs attention")
    expect(errorControlId("workLines.0.hours")).toBe("log-line-0-hours")
    expect(errorControlId("workLines")).toBe("log-line-0-costCode")
  })

  it("confirms the save on the button", () => {
    expect(saveButtonLabel("idle", false)).toBe("Save for sync")
    expect(saveButtonLabel("saved", false)).toBe("✓ Saved on this phone")
    expect(saveButtonLabel("synced", true)).toBe("✓ Saved and synced")
  })
})

describe("Field Mode daily log to-dos and client contact", () => {
  const setup = {
    rules: {
      todoMode: "ask" as const,
      todoTypes: ["staff_task" as const, "supplier_task" as const],
      workedMovesToInProgress: true,
      todosCanComplete: true,
      carryBlocked: true,
      todoCostCodes: true,
      tickAddsLine: true,
      crewPicksCostCode: true,
      clientContact: true,
      clientContactSuggest: true,
      minimumSummaryCharacters: 15,
    },
    openTodos: [
      { id: "t1", title: "Joists <east>", status: "open" as const, recordType: "staff_task", assigneeName: "Dan", companyName: null, costCode: "01 71 13", changedOn: "2026-10-12" },
      { id: "t2", title: "Framing inspection", status: "blocked" as const, recordType: "staff_task", assigneeName: null, companyName: null, costCode: null, changedOn: "2026-10-12" },
    ],
    doneStatusLabel: "Done",
    clientContacts: [{ id: "c1", name: "Jordan Bishop", role: "Owner" }],
    assignees: [{ name: "Nu-Tech", kind: "supplier_task" as const }],
    installableSelections: [],
  }
  const withSetup = { ...form, followUps: setup }

  it("shows blocked to-dos, the checklist, line to-dos and a contact suggestion", () => {
    const draft = { ...emptyLogDraft("2026-10-14"), issues: "Short on subfloor", visitorLog: "Bishop stopped by" }
    const html = logFieldsHtml({ draft, form: withSetup, errors: new Map(), escape })
    expect(html).toContain("Blocked to-dos")
    expect(html).toContain('data-fu="blocked" data-fu-key="t2"')
    expect(html).toContain("Joists &lt;east>")
    expect(html).toContain('data-fu="line-toggle" data-fu-key="issues:Short on subfloor"')
    expect(html).toContain("Visitors mentions Jordan Bishop")
  })

  it("applies control changes to the draft", () => {
    const rules = setup.rules
    const key = () => "row-1"
    let draft = followUpAction(emptyFollowUpDraft(), rules, { control: "suggest-accept", key: "", value: "c1" }, key)
    expect(draft.contacts).toEqual([expect.objectContaining({ key: "row-1", contactId: "c1", interactionType: "site_visit" })])
    draft = followUpAction(draft, rules, { control: "contact-direction", key: "row-1", value: "inbound" }, key)
    draft = followUpAction(draft, rules, { control: "contact-todo", key: "row-1", value: "true" }, key)
    expect(draft.contacts[0]).toEqual(expect.objectContaining({ direction: "inbound", followUpTodo: true }))
    draft = followUpAction(draft, rules, { control: "line-toggle", key: "issues:Short", value: "" }, key)
    draft = followUpAction(draft, rules, { control: "line-type", key: "issues:Short", value: "supplier_task" }, key)
    draft = followUpAction(draft, rules, { control: "line-assignee", key: "issues:Short", value: "Nu-Tech" }, key)
    expect(draft.lineTodos["issues:Short"]).toEqual({ recordType: "supplier_task", assigneeName: "Nu-Tech", costCode: "" })
    // Changing the type clears an assignee of the old kind.
    draft = followUpAction(draft, rules, { control: "line-type", key: "issues:Short", value: "staff_task" }, key)
    expect(draft.lineTodos["issues:Short"]?.assigneeName).toBe("")
    draft = followUpAction(draft, rules, { control: "blocked", key: "t2", value: "still" }, key)
    expect(draft.blocked).toEqual({ t2: "still" })
    draft = followUpAction(draft, rules, { control: "blocked", key: "t2", value: "still" }, key)
    expect(draft.blocked).toEqual({})
  })

  it("offers Worked on and Completed per to-do, named with the company's done status", () => {
    let followUps = followUpAction(emptyFollowUpDraft(), setup.rules, { control: "completed", key: "t1", value: "true" }, () => "k")
    expect(followUps.completed).toEqual(["t1"])
    // Completed implies worked on.
    expect(followUps.worked).toEqual(["t1"])
    const draft = { ...emptyLogDraft("2026-10-14"), followUps: storedFollowUpDraft(followUps) }
    const html = logFieldsHtml({ draft, form: withSetup, errors: new Map(), escape })
    expect(html).toMatch(/checked\s+data-fu="completed" data-fu-key="t1"/)
    expect(html).toContain("Open → Done")
    expect(followUpsFromDraft(draft.followUps, draft, setup.rules).todoUpdates).toEqual([{ todoId: "t1", worked: true, completed: true, blocked: null }])
    // Unticking takes it back entirely.
    followUps = followUpAction(followUps, setup.rules, { control: "completed", key: "t1", value: "false" }, () => "k")
    expect(followUps.completed).toEqual([])
    expect(followUps.worked).toEqual([])
    // Off for the company: no Completed choice.
    const off = logFieldsHtml({ draft, form: { ...form, followUps: { ...setup, rules: { ...setup.rules, todosCanComplete: false } } }, errors: new Map(), escape })
    expect(off).not.toContain('data-fu="completed"')
  })

  it("keeps drafts saved before Completed, and logs queued before it parse as not completed", () => {
    const old: Record<string, unknown> = { ...emptyFollowUpDraft(), worked: ["t1"] }
    delete old.completed
    expect(logDraftSchema.parse({ ...emptyLogDraft("2026-10-14"), followUps: old }).followUps.completed).toEqual([])
    const outbox = fieldOutboxSchema.parse([{
      id: "q1",
      kind: "daily_log",
      projectId: "p1",
      createdAt: "2026-10-14T12:00:00Z",
      payload: {
        logDate: "2026-10-14",
        workCompleted: "Joists",
        issues: "",
        crewPresent: "Dan",
        notes: "",
        followUps: { todoUpdates: [{ todoId: "t1", worked: true, blocked: null }], newTodos: [], clientContacts: [] },
      },
      remoteDailyLogId: null,
      attachments: [],
    }])
    const entry = outbox[0]
    expect(entry?.kind === "daily_log" ? entry.payload.followUps?.todoUpdates : null).toEqual([{ todoId: "t1", worked: true, completed: false, blocked: null }])
  })

  it("keeps drafts saved before to-dos", () => {
    const old: Record<string, unknown> = { ...emptyLogDraft("2026-10-14") }
    delete old.followUps
    const parsed = logDraftSchema.parse(old)
    expect(parsed.followUps.worked).toEqual([])
  })
})

describe("Field Mode daily log selections installed", () => {
  const rules = {
    todoMode: "off" as const,
    todoTypes: [],
    workedMovesToInProgress: false,
    todosCanComplete: false,
    carryBlocked: false,
    todoCostCodes: false,
    tickAddsLine: false,
    crewPicksCostCode: false,
    clientContact: false,
    clientContactSuggest: false,
    minimumSummaryCharacters: 0,
  }
  const setup = {
    rules,
    openTodos: [],
    doneStatusLabel: "Complete",
    clientContacts: [],
    assignees: [],
    installableSelections: [
      { id: "s1", name: "Kitchen faucet <brass>", roomName: "Kitchen", status: "ordered" },
      { id: "s2", name: "Tile", roomName: "", status: "approved" },
    ],
  }
  const key = (): string => "unused"

  it("folds selections that aren't ordered or approved under Other selections", () => {
    const wide = { ...setup, installableSelections: [...setup.installableSelections, { id: "s3", name: "Range hood", roomName: "Kitchen", status: "owner_review" }] }
    let html = installedSelectionsHtml(wide, emptyFollowUpDraft(), escape)
    expect(html).toContain("Other selections (1)")
    expect(html).not.toContain("<details open>")
    expect(html).toContain("Kitchen · With owner")
    html = installedSelectionsHtml(wide, followUpAction(emptyFollowUpDraft(), rules, { control: "installed", key: "s3", value: "true" }, key), escape)
    expect(html).toContain("<details open>")
  })

  it("is hidden when the job has no selections left to install", () => {
    const html = logFieldsHtml({ draft: emptyLogDraft("2026-11-09"), form: { ...form, followUps: { ...setup, installableSelections: [] } }, errors: new Map(), escape })
    expect(html).not.toContain("Selections installed")
  })

  it("lists each selection with its room and status, and shows the move once ticked", () => {
    let draft = emptyLogDraft("2026-11-09")
    let html = logFieldsHtml({ draft, form: { ...form, followUps: setup }, errors: new Map(), escape })
    expect(html).toContain("Selections installed")
    expect(html).toContain('data-fu="installed" data-fu-key="s1"')
    expect(html).toContain("Kitchen faucet &lt;brass>")
    expect(html).toContain("Kitchen · Ordered")
    expect(html).toContain(">Approved</span>")
    draft = { ...draft, followUps: storedFollowUpDraft(followUpAction(draft.followUps, rules, { control: "installed", key: "s1", value: "true" }, key)) }
    html = installedSelectionsHtml(setup, draft.followUps, escape)
    expect(html).toContain("Ordered → Installed")
    expect(html).toMatch(/checked\s+data-fu="installed" data-fu-key="s1"/)
  })

  it("ticks and unticks, and the ticks reach the log's follow-ups", () => {
    let followUps = followUpAction(emptyFollowUpDraft(), rules, { control: "installed", key: "s1", value: "true" }, key)
    followUps = followUpAction(followUps, rules, { control: "installed", key: "s2", value: "true" }, key)
    followUps = followUpAction(followUps, rules, { control: "installed", key: "s1", value: "true" }, key)
    expect(followUps.installed).toEqual(["s2", "s1"])
    followUps = followUpAction(followUps, rules, { control: "installed", key: "s2", value: "false" }, key)
    expect(followUps.installed).toEqual(["s1"])
    const draft = { ...emptyLogDraft("2026-11-09"), followUps: storedFollowUpDraft(followUps) }
    expect(followUpsFromDraft(draft.followUps, draft, rules).installedSelectionIds).toEqual(["s1"])
  })

  it("keeps ticks through the saved draft, and drafts saved before this start with none", () => {
    const followUps = storedFollowUpDraft(followUpAction(emptyFollowUpDraft(), rules, { control: "installed", key: "s1", value: "true" }, key))
    const saved = logDraftSchema.parse(JSON.parse(JSON.stringify({ ...emptyLogDraft("2026-11-09"), followUps })))
    expect(saved.followUps.installed).toEqual(["s1"])
    const old: Record<string, unknown> = { ...emptyFollowUpDraft() }
    delete old.installed
    expect(logDraftSchema.parse({ ...emptyLogDraft("2026-11-09"), followUps: old }).followUps.installed).toEqual([])
  })

  it("reads packets saved before selections, and queued logs with or without installed selections", () => {
    const packet = fieldProjectPacketSchema.parse({
      project: { id: "p1", name: "Job", projectNumber: null, address: null },
      tasks: [],
      logs: [],
      documents: [],
      channel: null,
      messages: [],
      dailyLogForm: { ...form, followUps: { rules, openTodos: [], clientContacts: [], assignees: [] } },
      syncedAt: "2026-11-09T12:00:00Z",
    })
    expect(packet.dailyLogForm?.followUps?.installableSelections).toEqual([])
    const payload = {
      logDate: "2026-11-09",
      workCompleted: "Set fixtures",
      issues: "",
      crewPresent: "Dan",
      notes: "",
      followUps: { todoUpdates: [], newTodos: [], clientContacts: [] },
    }
    const item = (id: string, followUps: Record<string, unknown>) => ({
      id,
      kind: "daily_log",
      projectId: "p1",
      createdAt: "2026-11-09T12:00:00Z",
      payload: { ...payload, followUps },
      remoteDailyLogId: null,
      attachments: [],
    })
    const outbox = fieldOutboxSchema.parse(JSON.parse(JSON.stringify([
      item("old", payload.followUps),
      item("new", { ...payload.followUps, installedSelectionIds: ["s1"] }),
    ])))
    const followUpsOf = (index: number) => {
      const entry = outbox[index]
      return entry?.kind === "daily_log" ? entry.payload.followUps : undefined
    }
    expect(followUpsOf(0)?.installedSelectionIds).toBeUndefined()
    expect(followUpsOf(1)?.installedSelectionIds).toEqual(["s1"])
  })
})
