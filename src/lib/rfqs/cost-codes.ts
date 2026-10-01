type CodedScopeLine = {
  readonly costCode: string | null
  // RFQ payloads retain the legacy field name; its value is a Sage division.
  readonly phaseCode: string | null
}

export function rfqScopeCodingErrors(
  lines: readonly CodedScopeLine[],
  sageCodeDivisions: ReadonlyMap<string, string>,
  sageDivisions: ReadonlySet<string>,
  existingLines: readonly CodedScopeLine[] = []
): readonly string[] {
  return lines.flatMap((line, index) => {
    const previous = existingLines[index]
    if (
      previous?.costCode === line.costCode &&
      previous.phaseCode === line.phaseCode
    ) return []

    const row = index + 1
    if (line.phaseCode && !sageDivisions.has(line.phaseCode)) {
      return [`Scope row ${row}: choose an active Sage division.`]
    }
    if (!line.costCode) return []

    const division = sageCodeDivisions.get(line.costCode)
    if (!division) {
      return [`Scope row ${row}: choose an active Sage cost code.`]
    }
    if (line.phaseCode !== division) {
      return [`Scope row ${row}: division must match cost code ${line.costCode}.`]
    }
    return []
  })
}
