/**
 * The areas of a job's Selections page, picked one at a time with the
 * "Work on" picker (`?work=` in the URL). The first area is the default.
 */
export const SELECTION_WORK_AREAS = [
  {
    value: "sheet",
    label: "Selection sheet",
    description: "Rounds, every selection in one sheet, and the detail drawer.",
  },
  {
    value: "publish",
    label: "Publish to owner",
    description: "Set allowance, price and due date, and publish selections by room.",
  },
  {
    value: "specs",
    label: "Finish specs",
    description: "Edit products, quantities and notes room by room, or import a schedule.",
  },
  {
    value: "share",
    label: "Print & share",
    description: "Print by room or category, copy a spreadsheet, or share by email.",
  },
] as const

export type SelectionWorkArea = (typeof SELECTION_WORK_AREAS)[number]["value"]

function isSelectionWorkArea(value: string): value is SelectionWorkArea {
  return SELECTION_WORK_AREAS.some((area) => area.value === value)
}

/** The area named by `?work=`, or the selection sheet. */
export function parseSelectionWorkArea(value: string | undefined): SelectionWorkArea {
  return value !== undefined && isSelectionWorkArea(value) ? value : "sheet"
}
