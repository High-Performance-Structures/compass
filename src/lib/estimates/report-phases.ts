export type EstimateReportPhase = {
  readonly id: string
  readonly divisionCode: string
  readonly name: string
  readonly description: string
  readonly itemize: boolean
  readonly sortOrder: number
}

export type EstimateReportPhaseInput = Omit<EstimateReportPhase, "id"> & {
  readonly lineIds: readonly string[]
}

export function validateEstimateReportPhase(
  input: EstimateReportPhaseInput,
  lines: readonly { readonly id: string; readonly divisionCode: string }[]
):
  | { readonly success: true; readonly value: EstimateReportPhaseInput }
  | { readonly success: false; readonly error: string } {
  const name = input.name.trim()
  const description = input.description.trim()
  const divisionCode = input.divisionCode.trim()
  if (!/^\d{2}$/.test(divisionCode)) {
    return { success: false, error: "Choose a source CSI division." }
  }
  if (name.length === 0 || name.length > 160) {
    return { success: false, error: "Phase name must be between 1 and 160 characters." }
  }
  if (description.length > 6_000) {
    return { success: false, error: "Phase description must be 6,000 characters or fewer." }
  }
  if (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 1) {
    return { success: false, error: "Report order must be a positive whole number." }
  }
  const lineIds = [...new Set(input.lineIds)]
  if (typeof input.itemize !== "boolean") {
    return { success: false, error: "Choose whether to itemize this report phase." }
  }
  const availableIds = new Set(
    lines.filter((line) => line.divisionCode === divisionCode).map((line) => line.id)
  )
  if (lineIds.some((id) => !availableIds.has(id))) {
    return { success: false, error: "Choose only estimate lines from this phase's CSI division." }
  }
  return {
    success: true,
    value: { divisionCode, name, description, itemize: input.itemize, sortOrder: input.sortOrder, lineIds },
  }
}
