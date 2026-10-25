// One "Save report settings" saves every changed part of an estimate's client
// report: the report view, the assemblies listed in detail, each CSI group
// description, and the appended acknowledgements. These helpers decide what
// changed and how to report a save that only partly succeeded.

export type ReportSettingsSection =
  | Readonly<{ kind: "view" }>
  | Readonly<{ kind: "assemblyDetail" }>
  | Readonly<{ kind: "phase"; divisionCode: string; label: string }>
  | Readonly<{ kind: "acknowledgements" }>

export type ReportSettingsState = Readonly<{
  view: Readonly<{ reportMode: string; showAssemblyBuilderFee: boolean; showCostBreakdowns: boolean }>
  assemblyDetailIds: readonly string[]
  phaseDescriptions: ReadonlyMap<string, string>
  acknowledgementIds: readonly string[]
}>

export type PhaseLabel = readonly [divisionCode: string, divisionName: string]

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id))
}

/** The sections whose draft differs from what is saved, in display order. */
export function changedReportSettings(
  saved: ReportSettingsState,
  draft: ReportSettingsState,
  phases: readonly PhaseLabel[],
  includeAcknowledgements: boolean,
): readonly ReportSettingsSection[] {
  const sections: ReportSettingsSection[] = []
  if (
    saved.view.reportMode !== draft.view.reportMode ||
    saved.view.showAssemblyBuilderFee !== draft.view.showAssemblyBuilderFee ||
    saved.view.showCostBreakdowns !== draft.view.showCostBreakdowns
  ) {
    sections.push({ kind: "view" })
  }
  if (!sameIds(saved.assemblyDetailIds, draft.assemblyDetailIds)) {
    sections.push({ kind: "assemblyDetail" })
  }
  for (const [divisionCode, divisionName] of phases) {
    const before = (saved.phaseDescriptions.get(divisionCode) ?? "").trim()
    const after = (draft.phaseDescriptions.get(divisionCode) ?? "").trim()
    if (before !== after) {
      sections.push({ kind: "phase", divisionCode, label: `${divisionCode} - ${divisionName}` })
    }
  }
  if (includeAcknowledgements && !sameIds(saved.acknowledgementIds, draft.acknowledgementIds)) {
    sections.push({ kind: "acknowledgements" })
  }
  return sections
}

export function reportSettingsSectionLabel(section: ReportSettingsSection): string {
  switch (section.kind) {
    case "view":
      return "report view"
    case "assemblyDetail":
      return "assembly detail"
    case "phase":
      return `${section.label} description`
    case "acknowledgements":
      return "acknowledgements"
  }
}

export type ReportSettingsSaveResult = Readonly<{
  section: ReportSettingsSection
  error: string | null
}>

/** One message for the whole save, naming exactly what failed. */
export function reportSettingsSaveMessage(results: readonly ReportSettingsSaveResult[]): string {
  const failed = results.filter((result) => result.error !== null)
  if (failed.length === 0) return "Report settings saved."
  const saved = results.filter((result) => result.error === null).map((result) => reportSettingsSectionLabel(result.section))
  const failures = failed.map((result) => `${reportSettingsSectionLabel(result.section)}: ${result.error}`).join("; ")
  return saved.length > 0
    ? `Saved ${saved.join(", ")}. Couldn't save ${failures}`
    : `Couldn't save ${failures}`
}
