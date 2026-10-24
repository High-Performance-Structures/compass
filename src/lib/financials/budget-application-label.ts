/**
 * How a budget application is named on screen. The contract budget itself is
 * stored in the pay-application format, but it isn't a pay application.
 */
export function budgetApplicationLabel(application: {
  readonly sourceSystem: string
  readonly applicationNumber: string
}): string {
  return application.sourceSystem === "compass_contract_budget_projection"
    ? application.applicationNumber.replace(/^Contract Budget/, "Contract budget")
    : `Pay app ${application.applicationNumber}`
}
