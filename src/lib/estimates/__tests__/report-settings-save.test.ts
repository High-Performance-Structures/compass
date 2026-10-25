import { describe, expect, it } from "vitest"

import {
  changedReportSettings,
  reportSettingsSaveMessage,
  type ReportSettingsState,
} from "@/lib/estimates/report-settings-save"

const saved: ReportSettingsState = {
  view: { reportMode: "line_items", showAssemblyBuilderFee: false, showCostBreakdowns: false },
  assemblyDetailIds: ["a1"],
  phaseDescriptions: new Map([["03", "Concrete work"]]),
  acknowledgementIds: ["t1"],
}
const phases = [["03", "Concrete"], ["06", "Wood"]] as const

describe("changedReportSettings", () => {
  it("finds nothing when the draft matches what is saved", () => {
    expect(changedReportSettings(saved, saved, phases, true)).toEqual([])
  })

  it("lists every changed section once, in display order", () => {
    const draft: ReportSettingsState = {
      view: { ...saved.view, showCostBreakdowns: true },
      assemblyDetailIds: ["a1", "a2"],
      phaseDescriptions: new Map([["03", "Concrete work"], ["06", "Framing"]]),
      acknowledgementIds: [],
    }
    expect(changedReportSettings(saved, draft, phases, true)).toEqual([
      { kind: "view" },
      { kind: "assemblyDetail" },
      { kind: "phase", divisionCode: "06", label: "06 - Wood" },
      { kind: "acknowledgements" },
    ])
  })

  it("ignores id order and surrounding spaces", () => {
    const draft: ReportSettingsState = {
      ...saved,
      phaseDescriptions: new Map([["03", "  Concrete work "]]),
    }
    expect(changedReportSettings({ ...saved, assemblyDetailIds: ["a1", "a2"] }, { ...draft, assemblyDetailIds: ["a2", "a1"] }, phases, true)).toEqual([])
  })

  it("skips acknowledgements for departments without them", () => {
    expect(changedReportSettings(saved, { ...saved, acknowledgementIds: [] }, phases, false)).toEqual([])
  })
})

describe("reportSettingsSaveMessage", () => {
  it("confirms a full save", () => {
    expect(reportSettingsSaveMessage([{ section: { kind: "view" }, error: null }])).toBe("Report settings saved.")
  })

  it("names exactly which section failed and what was saved", () => {
    expect(
      reportSettingsSaveMessage([
        { section: { kind: "view" }, error: null },
        { section: { kind: "phase", divisionCode: "06", label: "06 - Wood" }, error: "Description is too long." },
      ])
    ).toBe("Saved report view. Couldn't save 06 - Wood description: Description is too long.")
  })

  it("reports a total failure without claiming anything saved", () => {
    expect(
      reportSettingsSaveMessage([{ section: { kind: "acknowledgements" }, error: "Not allowed." }])
    ).toBe("Couldn't save acknowledgements: Not allowed.")
  })
})
