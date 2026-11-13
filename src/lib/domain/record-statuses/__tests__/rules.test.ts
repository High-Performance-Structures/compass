import { describe, expect, it } from "vitest"

import { RECORD_STATUS_REGISTRY } from "../registry"
import {
  defaultRecordStatusList,
  isOpenRecordStatus,
  isSelectableRecordStatus,
  newRecordStatusKey,
  parseRecordStatusFilter,
  planRecordStatusDelete,
  planRecordStatusSave,
  recordStatusExactKey,
  recordStatusFilterOptions,
  recordStatusLabel,
  recordStatusMatchesFilter,
  recordStatusSortValue,
  resolveRecordStatuses,
  selectableRecordStatuses,
  type RecordStatusEdit,
  type StoredRecordStatus,
} from "../rules"
import { RECORD_STATUS_TYPES } from "../statuses"

function stored(statusKey: string, sortOrder: number, extra: Partial<StoredRecordStatus> = {}): StoredRecordStatus {
  return {
    statusKey,
    label: statusKey,
    color: "gray",
    statusGroup: "open",
    sortOrder,
    showAsButton: true,
    hidden: false,
    builtIn: true,
    ...extra,
  }
}

function edits(type: (typeof RECORD_STATUS_TYPES)[number]): RecordStatusEdit[] {
  return defaultRecordStatusList(type).statuses.map((status) => ({
    key: status.key,
    label: status.label,
    color: status.color,
    group: status.group,
    showAsButton: status.showAsButton,
    hidden: status.hidden,
  }))
}

describe("record status defaults", () => {
  it("every registered type has built-in statuses with unique keys and an Open status", () => {
    for (const type of RECORD_STATUS_TYPES) {
      const keys = RECORD_STATUS_REGISTRY[type].statuses.map((status) => status.key)
      expect(new Set(keys).size).toBe(keys.length)
      expect(RECORD_STATUS_REGISTRY[type].statuses.some((status) => status.group === "open")).toBe(true)
      for (const target of Object.values(RECORD_STATUS_REGISTRY[type].aliases)) expect(keys).toContain(target)
    }
  })

  it("with no company rows, resolves to the code defaults, all shown", () => {
    for (const type of RECORD_STATUS_TYPES) {
      expect(resolveRecordStatuses(type, [])).toEqual(defaultRecordStatusList(type))
    }
    const list = defaultRecordStatusList("purchase_order")
    expect(list.statuses.every((status) => status.builtIn && status.showAsButton && !status.hidden)).toBe(true)
  })

  it("reads Buildertrend's imported spellings as real statuses, not unknown values", () => {
    expect(recordStatusExactKey(defaultRecordStatusList("todo"), "incomplete")).toBe("open")
    expect(recordStatusExactKey(defaultRecordStatusList("rfq"), "open")).toBe("sent")
  })

  it("reads stored spellings through aliases and the type's unknown fallback", () => {
    const rfi = defaultRecordStatusList("rfi")
    expect(recordStatusLabel(rfi, "answered")).toBe("In progress")
    expect(recordStatusLabel(rfi, "something odd")).toBe("New")
    const po = defaultRecordStatusList("purchase_order")
    expect(recordStatusLabel(po, "Partially-Received")).toBe("Partially received")
    expect(recordStatusLabel(po, "backordered")).toBe("Backordered")
    expect(isOpenRecordStatus(po, "backordered")).toBe(true)
    expect(recordStatusSortValue(po, "backordered")).toBe(po.statuses.length)
  })

  it("keeps a to-do status keyed open apart from the Open button", () => {
    const todo = defaultRecordStatusList("todo")
    const values = recordStatusFilterOptions(todo, []).map((option) => option.value)
    expect(values).toEqual(["open", "open_status", "in_progress", "blocked", "complete", "archived", "all"])
    expect(parseRecordStatusFilter(todo, "open_status")).toBe("open_status")
    expect(recordStatusMatchesFilter(todo, "open", "open_status")).toBe(true)
    expect(recordStatusMatchesFilter(todo, "blocked", "open_status")).toBe(false)
  })
})

describe("merging company statuses over the defaults", () => {
  it("applies the company's labels, colors, groups, order and hidden state, never its own built-in keys", () => {
    const list = resolveRecordStatuses("purchase_order", [
      stored("sent", 0, { label: "Emailed", color: "green" }),
      stored("draft", 1),
      stored("received", 2, { statusGroup: "closed" }),
      stored("backordered", 3, { label: "Backordered", builtIn: false, color: "orange" }),
      stored("ordered", 4, { hidden: true }),
      stored("approved", 5),
      stored("partially_received", 6),
      stored("complete", 7, { statusGroup: "closed" }),
      stored("closed", 8, { statusGroup: "closed" }),
      stored("void", 9, { statusGroup: "void", showAsButton: false }),
      // A built-in row Compass no longer has is ignored.
      stored("retired_status", 10),
    ])
    expect(list.statuses.map((status) => status.key)).toEqual([
      "sent", "draft", "received", "backordered", "ordered", "approved", "partially_received", "complete", "closed", "void",
    ])
    expect(recordStatusLabel(list, "Sent")).toBe("Emailed")
    expect(list.statuses.find((status) => status.key === "backordered")?.builtIn).toBe(false)
    expect(list.statuses.find((status) => status.key === "sent")?.builtIn).toBe(true)
    expect(isOpenRecordStatus(list, "received")).toBe(false)
    expect(recordStatusSortValue(list, "draft")).toBe(1)

    const buttons = recordStatusFilterOptions(list, []).map((option) => option.value)
    expect(buttons).not.toContain("ordered")
    expect(buttons).not.toContain("void")
    expect(buttons.slice(0, 4)).toEqual(["open", "sent", "draft", "received"])
  })

  it("places a built-in status with no row after the default status before it", () => {
    const list = resolveRecordStatuses("rfi", [stored("complete", 0), stored("new", 1)])
    // Void follows Complete (its default predecessor); the rest follow New.
    expect(list.statuses.map((status) => status.key)).toEqual(["complete", "void", "new", "in_progress", "info_needed"])
  })

  it("status selects offer visible statuses, plus a record's own hidden one", () => {
    const list = resolveRecordStatuses("purchase_order", [stored("ordered", 3, { hidden: true })])
    expect(selectableRecordStatuses(list).map((option) => option.value)).not.toContain("ordered")
    expect(selectableRecordStatuses(list, "ordered").map((option) => option.value)).toContain("ordered")
    expect(isSelectableRecordStatus(list, "ordered")).toBe(false)
    expect(isSelectableRecordStatus(list, "ordered", "Ordered")).toBe(true)
    expect(isSelectableRecordStatus(list, "draft")).toBe(true)
    expect(isSelectableRecordStatus(list, "response_received")).toBe(false)
  })
})

describe("planning a save", () => {
  it("saves the whole list in order and gives a new status a stable key", () => {
    const plan = planRecordStatusSave("purchase_order", [], [
      { key: null, label: "Back-ordered", color: "orange", group: "open", showAsButton: true, hidden: false },
      ...edits("purchase_order"),
    ])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value[0]).toMatchObject({ statusKey: "back_ordered", sortOrder: 0, builtIn: false })
    expect(plan.value.filter((row) => row.builtIn)).toHaveLength(RECORD_STATUS_REGISTRY.purchase_order.statuses.length)
  })

  it("refuses to drop a built-in status", () => {
    const plan = planRecordStatusSave("purchase_order", [], edits("purchase_order").filter((edit) => edit.key !== "void"))
    expect(plan).toEqual({ ok: false, error: expect.stringContaining("Built-in statuses can't be deleted") })
  })

  it("refuses to drop a saved company status (Delete checks it is unused)", () => {
    const plan = planRecordStatusSave("purchase_order", [stored("backordered", 0, { builtIn: false })], edits("purchase_order"))
    expect(plan.ok).toBe(false)
  })

  it("refuses a key this company does not have, duplicates and blank names", () => {
    const foreign = planRecordStatusSave("purchase_order", [], [
      ...edits("purchase_order"),
      { key: "someone_elses", label: "Theirs", color: "gray", group: "open", showAsButton: true, hidden: false },
    ])
    expect(foreign.ok).toBe(false)
    const duplicate = edits("purchase_order")
    const first = duplicate[0]
    if (!first) throw new Error("no defaults")
    duplicate.push({ ...first, key: null })
    expect(planRecordStatusSave("purchase_order", [], duplicate).ok).toBe(false)
    const blank = edits("purchase_order").map((edit, index) => (index === 0 ? { ...edit, label: "  " } : edit))
    expect(planRecordStatusSave("purchase_order", [], blank)).toEqual({ ok: false, error: "Every status needs a name." })
  })

  it("never reuses a built-in key, a known spelling or a filter word for a new status", () => {
    const taken = new Set<string>(["backordered"])
    expect(newRecordStatusKey("purchase_order", "Draft", taken)).toBe("draft_2")
    expect(newRecordStatusKey("purchase_order", "Archived", taken)).toBe("archived_2")
    expect(newRecordStatusKey("purchase_order", "All", taken)).toBe("all_2")
    expect(newRecordStatusKey("purchase_order", "Backordered", taken)).toBe("backordered_2")
    expect(newRecordStatusKey("purchase_order", "!!!", taken)).toBe("status")
  })
})

describe("planning a delete", () => {
  const rows = [stored("backordered", 0, { label: "Backordered", builtIn: false })]

  it("refuses a built-in status", () => {
    const plan = planRecordStatusDelete("purchase_order", rows, "draft", 0)
    expect(plan).toEqual({ ok: false, error: expect.stringContaining("built-in status") })
  })

  it("refuses a status records use, offering Hide", () => {
    const plan = planRecordStatusDelete("purchase_order", rows, "backordered", 3)
    expect(plan).toEqual({ ok: false, error: expect.stringContaining("Hide it instead") })
  })

  it("allows an unused company status", () => {
    expect(planRecordStatusDelete("purchase_order", rows, "backordered", 0)).toEqual({ ok: true, value: { label: "Backordered" } })
    expect(planRecordStatusDelete("purchase_order", rows, "missing", 0).ok).toBe(false)
  })
})
