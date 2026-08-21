const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type ScheduleChangeProposalInput = {
  readonly startDate: string
  readonly workdays: number
  readonly note?: string
}

export type ValidScheduleChangeProposal = {
  readonly startDate: string
  readonly workdays: number
  readonly note: string | null
}

type ScheduleChangeProposalValidation =
  | { readonly success: true; readonly proposal: ValidScheduleChangeProposal }
  | { readonly success: false; readonly error: string }

function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function validateScheduleChangeProposal(
  input: ScheduleChangeProposalInput
): ScheduleChangeProposalValidation {
  const startDate = input.startDate.trim()
  if (!isValidDateKey(startDate)) {
    return { success: false, error: "Choose a valid proposed start date." }
  }
  if (!Number.isInteger(input.workdays) || input.workdays < 1 || input.workdays > 3650) {
    return {
      success: false,
      error: "Proposed duration must be between 1 and 3,650 workdays.",
    }
  }
  const note = input.note?.trim() ?? ""
  if (note.length > 1000) {
    return { success: false, error: "Proposal notes cannot exceed 1,000 characters." }
  }
  return {
    success: true,
    proposal: {
      startDate,
      workdays: input.workdays,
      note: note.length > 0 ? note : null,
    },
  }
}
