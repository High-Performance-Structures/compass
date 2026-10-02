import { describe, expect, it } from "vitest"

import {
  inboundRouteLabel,
  parseStaffSmsCommand,
  projectSmsHelp,
  projectListSmsChunks,
} from "@/lib/goto/staff-commands"

describe("staff SMS commands", () => {
  it("recognizes list commands with an optional department", () => {
    expect(parseStaffSmsCommand("[list]")).toEqual({
      kind: "list",
      department: null,
    })
    expect(parseStaffSmsCommand(" [LIST d] ")).toEqual({
      kind: "list",
      department: "D",
    })
  })

  it("recognizes the public help command", () => {
    const help = projectSmsHelp([
      { label: "HPS", phoneNumber: "(719) 900-8850" },
    ])
    expect(parseStaffSmsCommand(" [HELP] ")).toEqual({ kind: "help" })
    expect(help).toContain("HPS: (719) 900-8850")
    expect(help).toContain(
      "H-430-1900 [DAILY LOG] Crew arrived at 7:00."
    )
    expect(help).toContain(
      "text [list] or [help] to HPS only: (719) 900-8850"
    )
    expect(help.length).toBeLessThanOrEqual(850)
  })

  it("keeps ordinary project updates out of command handling", () => {
    expect(
      parseStaffSmsCommand("O-214-55 [DAILY LOG] Framing started.")
    ).toEqual({ kind: "none" })
    expect(parseStaffSmsCommand("[list sales]")).toEqual({
      kind: "invalid_list",
    })
  })

  it("formats department-scoped project lists", () => {
    expect(
      projectListSmsChunks({
        departments: ["O"],
        projects: [
          { department: "O", projectNumber: "O-214-55", name: "Smith" },
          { department: "H", projectNumber: "H-300-00", name: "Shop" },
        ],
      })
    ).toEqual(["Active O projects (1)\nO-214-55 - Smith"])
  })

  it("splits long lists without splitting a project line", () => {
    const chunks = projectListSmsChunks({
      departments: ["N"],
      projects: Array.from({ length: 30 }, (_, index) => ({
        department: "N" as const,
        projectNumber: `N-${index + 1}-00`,
        name: `Project ${index + 1} with a descriptive name`,
      })),
    })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 850)).toBe(true)
    expect(chunks.join("\n")).toContain("N-30-00")
  })

  it("uses field-friendly receipt labels", () => {
    expect(inboundRouteLabel("routed_daily_log")).toBe("a daily log")
    expect(inboundRouteLabel("routed_video")).toBe("a project video")
    expect(inboundRouteLabel("routed_message")).toBe("a project message")
  })
})
