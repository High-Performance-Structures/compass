import { describe, expect, it } from "vitest"

import {
  displaySmsPhoneNumber,
  gotoDepartmentsForOwnerNumber,
  gotoDepartmentSmsDirectory,
  gotoProjectListDepartmentsForOwnerNumber,
} from "@/lib/goto/numbers"

const ENV = {
  GOTO_SMS_ORC_FROM_NUMBER: "+17195550100",
  GOTO_SMS_NUTECH_FROM_NUMBER: "+17195550200",
  GOTO_SMS_HPS_FROM_NUMBER: "+17195550300",
}

describe("GoTo department numbers", () => {
  it("maps dedicated numbers and the shared ORC/Design number", () => {
    expect(gotoDepartmentsForOwnerNumber(ENV, "719-555-0100")).toEqual([
      "O",
      "D",
    ])
    expect(gotoDepartmentsForOwnerNumber(ENV, "+17195550200")).toEqual(["N"])
    expect(gotoDepartmentsForOwnerNumber(ENV, "+17195550300")).toEqual(["H"])
  })

  it("rejects unconfigured receiving numbers", () => {
    expect(gotoDepartmentsForOwnerNumber(ENV, "+17195550999")).toEqual([])
  })

  it("uses HPS as the complete active-project list endpoint", () => {
    expect(
      gotoProjectListDepartmentsForOwnerNumber(ENV, "+17195550300")
    ).toEqual(["O", "D", "H", "N"])
    expect(
      gotoProjectListDepartmentsForOwnerNumber(ENV, "+17195550100")
    ).toEqual(["O", "D"])
  })

  it("supports the legacy single GoTo sender number as ORC and Design", () => {
    const legacyEnv = { GOTO_SMS_FROM_NUMBER: "+17195550400" }
    expect(gotoDepartmentsForOwnerNumber(legacyEnv, "+17195550400")).toEqual([
      "O",
      "D",
    ])
  })

  it("keeps an accepted legacy number mapped when a dedicated ORC number exists", () => {
    const transitionEnv = {
      ...ENV,
      GOTO_SMS_FROM_NUMBER: "+17195550400",
    }
    expect(
      gotoDepartmentsForOwnerNumber(transitionEnv, "+17195550400")
    ).toEqual(["O", "D"])
  })

  it("builds a display-ready department directory", () => {
    expect(gotoDepartmentSmsDirectory(ENV)).toEqual([
      { label: "Open Range / Design", phoneNumber: "+17195550100" },
      { label: "Nu-Tech", phoneNumber: "+17195550200" },
      { label: "HPS", phoneNumber: "+17195550300" },
    ])
    expect(displaySmsPhoneNumber("+17199008850")).toBe("(719) 900-8850")
  })
})
