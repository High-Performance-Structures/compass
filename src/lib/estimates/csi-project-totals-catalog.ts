export type CsiProjectTotalsCatalogItem = {
  readonly code: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionDescription: string
}

// CSI rows present in the company Project Totals workbook that are not yet
// represented by an active Sage code or a name-derived Sage job-cost row.
export const CSI_PROJECT_TOTALS_FALLBACK_COST_CODES: readonly CsiProjectTotalsCatalogItem[] = [
  { code: "00 00 00", description: "Procurement Requirements", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 00 10", description: "Instructions", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 25 00", description: "Procurement Meetings", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 31 19", description: "Existing Condition Information", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 31 21.13", description: "Site Survey Information", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 31 21.16", description: "Measured Drawing Information", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 31 32", description: "Geotechnical Data", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 31 32.19", description: "Exploratory Excavation Information", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 61 00", description: "Bonds", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 62 00", description: "Certificates - insurance certs", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "00 72 00", description: "General Conditions", divisionCode: "00", divisionDescription: "Procurement Requirements" },
  { code: "01 00 00", description: "General Requirements", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 26 63", description: "Change Orders", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 32 00", description: "Construction Progress Documentation", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 32 26", description: "Construction Progress Reporting", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 41 23", description: "Fees - Dump", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 50 00", description: "Temporary Facilities and Controls", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 51 00", description: "Temporary Utilities", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 51 13", description: "Temporary Electricity", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 51 23", description: "Temporary Heating, Cooling, and Ventilation", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 51 26", description: "Temporary Lighting", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 51 33", description: "Temporary Telecommunications", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 51 36", description: "Temporary Water", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 52 13", description: "Field Offices & Shed - Portable Job Site", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 53 00", description: "Temporary Construction", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 54 23", description: "Temporary Scaffolding and Platforms", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 55 00", description: "Vehicular Access and Parking", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 56 00", description: "Temporary Barriers and Enclosures", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 56 26", description: "Temporary Fencing", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 57 13", description: "Temporary Erosion and Sediment Controls", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 60 00", description: "Product Requirements (Scope of Work)", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "01 70 00", description: "Execution and Closeout Requirements", divisionCode: "01", divisionDescription: "General Requirements" },
  { code: "03 40 00", description: "Precast Concrete", divisionCode: "03", divisionDescription: "Concrete" },
  { code: "07 46 43", description: "Composition Siding", divisionCode: "07", divisionDescription: "Thermal and Moisture Protection" },
  { code: "09 75 00", description: "Stone Facing", divisionCode: "09", divisionDescription: "Finishes" },
  { code: "48 00 00", description: "Electrical Power Generation Equipment", divisionCode: "48", divisionDescription: "Electrical Power Generation Equipment" },
  { code: "48 14 00", description: "Solar Energy Electrical Power Generation Equipment", divisionCode: "48", divisionDescription: "Electrical Power Generation Equipment" },
]
