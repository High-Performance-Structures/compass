import { describe, expect, it } from "vitest"

import {
  canAccessStaffBoard,
  validateStaffBoardPost,
} from "@/lib/staff-board"

describe("staff board access", () => {
  it("allows active internal staff and rejects external roles", () => {
    expect(canAccessStaffBoard("office", true, "internal")).toBe(true)
    expect(canAccessStaffBoard("field_crew", true, "internal")).toBe(true)
    expect(canAccessStaffBoard("owner", true, "client")).toBe(false)
    expect(canAccessStaffBoard("office", false, "internal")).toBe(false)
    expect(canAccessStaffBoard("office", true, "client")).toBe(false)
  })
})

describe("staff board post validation", () => {
  it("trims valid titles and bodies", () => {
    expect(
      validateStaffBoardPost({
        title: "  Monday update  ",
        body: "  The office is closed Friday.  ",
      })
    ).toEqual({
      success: true,
      data: {
        title: "Monday update",
        body: "The office is closed Friday.",
      },
    })
  })

  it("rejects missing or oversized content", () => {
    expect(validateStaffBoardPost({ title: "", body: "A post" })).toEqual({
      success: false,
      error: "Add a title.",
    })
    expect(validateStaffBoardPost({ title: "Update", body: "" })).toEqual({
      success: false,
      error: "Add a message.",
    })
    expect(
      validateStaffBoardPost({ title: "x".repeat(121), body: "A post" })
    ).toEqual({
      success: false,
      error: "Titles must be 120 characters or fewer.",
    })
    expect(
      validateStaffBoardPost({ title: "Update", body: "x".repeat(5001) })
    ).toEqual({
      success: false,
      error: "Messages must be 5,000 characters or fewer.",
    })
  })
})
