import { describe, expect, it } from "vitest"

import { hoursChargeLabel, machineFieldsHtml, machineSaveLabel, nextMachineDraft, updateMachineDraft } from "./machine-log-form"

const machine = {
  id: "m1",
  name: "Kubota SVL75-2",
  rateLabel: "Kubota Track Loader, $135.00/hr",
  runningRateCents: 13_500,
  standbyRateCents: 5_000,
  idleRateCents: null,
  hourMeter: 1_246.5,
  services: [{ id: "s1", name: "Oil change", dueLabel: "Oil change in 3.5 h", state: "soon" as const }],
}
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")

describe("Field Mode machine log", () => {
  it("keeps the machine and job for the next entry", () => {
    const first = { ...nextMachineDraft("hours", "2026-10-14", null, "p1"), machineId: "m1", runningHours: "6" }
    expect(nextMachineDraft("hours", "2026-10-14", first, "p2")).toMatchObject({ machineId: "m1", projectId: "p1", runningHours: "" })
    expect(nextMachineDraft("fuel", "2026-10-14", first, "p2")).toMatchObject({ machineId: "m1", projectId: "" })
  })

  it("updates fields by name and switches kinds cleanly", () => {
    let draft = { ...nextMachineDraft("hours", "2026-10-14", null, "p1"), machineId: "m1" }
    draft = updateMachineDraft(draft, "runningHours", "6")
    draft = updateMachineDraft(draft, "nonsense", "x")
    expect(draft.runningHours).toBe("6")
    const fuel = updateMachineDraft({ ...draft, hourMeter: "1250" }, "kind", "fuel")
    expect(fuel).toMatchObject({ kind: "fuel", machineId: "m1", projectId: "", runningHours: "", hourMeter: "1250" })
    expect(updateMachineDraft(draft, "kind", "bogus")).toBe(draft)
  })

  it("prices hours at the machine's rates", () => {
    const draft = { ...nextMachineDraft("hours", "2026-10-14", null, "p1"), machineId: "m1", runningHours: "6", standbyHours: "1" }
    expect(hoursChargeLabel(draft, machine)).toBe("$860.00")
    expect(hoursChargeLabel({ ...draft, kind: "fuel" }, machine)).toBe("")
  })

  it("shows the machine's rate, due services and errors", () => {
    const draft = { ...nextMachineDraft("hours", "2026-10-14", null, ""), machineId: "m1" }
    const html = machineFieldsHtml({ draft, machines: [machine], jobs: [{ value: "p1", label: "H-1 - Job" }], costCodes: [], errors: new Map([["projectId", "Choose the job the machine worked on."]]), escape })
    expect(html).toContain("Rate book: Kubota Track Loader, $135.00/hr · Hour meter 1,246.5")
    expect(html).toContain('class="field-hint service-soon">Oil change in 3.5 h')
    expect(html).toContain('id="machine-projectId" name="projectId" aria-invalid="true"')
    expect(html).toContain("1 item needs attention")
  })

  it("confirms the save on the button", () => {
    expect(machineSaveLabel("saved", false)).toBe("✓ Saved on this phone")
    expect(machineSaveLabel("idle", true)).toBe("Save and sync")
  })
})
