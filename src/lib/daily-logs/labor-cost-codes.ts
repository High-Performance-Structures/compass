/**
 * The labor cost codes field staff log time against on job daily logs: the
 * company's Sage Time & Attendance list. `payrollId` is the number Sage
 * timecards use (1711300 for 01 71 13). Companies edit the list in Settings.
 */

export type LaborCostCode = {
  readonly code: string
  readonly payrollId: string
  readonly name: string
  readonly active: boolean
}

/** Departments whose job daily logs use the labor list by default. */
export const DEFAULT_LABOR_CODE_DEPARTMENTS = ["H", "O"] as const

export const DEFAULT_LABOR_COST_CODES: readonly LaborCostCode[] = [
  { code: "00 25 00", payrollId: "3", name: "Procurement Meetings", active: true },
  { code: "01 24 13", payrollId: "1241300", name: "Value Engineering", active: true },
  { code: "01 26 63", payrollId: "1266300", name: "Change Orders", active: true },
  { code: "01 31 00", payrollId: "1310000", name: "Project Management & Coordination", active: true },
  { code: "01 31 19", payrollId: "1311900", name: "Project Meetings", active: true },
  { code: "01 31 19.13", payrollId: "1311913", name: "Preconstruction Meetings", active: true },
  { code: "01 31 23", payrollId: "1312300", name: "Project Website", active: true },
  { code: "01 32 00", payrollId: "1320000", name: "Construction Progress Documentation", active: true },
  { code: "01 32 16", payrollId: "1321600", name: "Construction Progress Schedule", active: true },
  { code: "01 32 26", payrollId: "1322600", name: "Construction Progress Reporting", active: true },
  { code: "01 32 29", payrollId: "1322900", name: "Periodic Work Observation", active: true },
  { code: "01 32 33", payrollId: "1323300", name: "Photographic Documentation", active: true },
  { code: "01 32 36", payrollId: "1323600", name: "Video Monitoring and Documentation", active: true },
  { code: "01 32 43", payrollId: "1324300", name: "Purchase Order Tracking", active: true },
  { code: "01 41 23", payrollId: "1412300", name: "Fees-Dump", active: true },
  { code: "01 45 16.13", payrollId: "1451613", name: "Contractor Quality Control", active: true },
  { code: "01 54 23", payrollId: "1542300", name: "Temp Scaffolding", active: true },
  { code: "01 65 00", payrollId: "1650000", name: "Delivery of Products", active: true },
  { code: "01 71 13", payrollId: "1711300", name: "Mobilization", active: true },
  { code: "01 73 23", payrollId: "1732300", name: "Bracing & Anchoring", active: true },
  { code: "01 74 13", payrollId: "1741300", name: "Progress Cleaning", active: true },
  { code: "01 74 23", payrollId: "1742300", name: "Final Cleaning", active: true },
  { code: "01 76 00", payrollId: "1760000", name: "Protecting Installed Construction", active: true },
  { code: "01 77 00", payrollId: "1770000", name: "Closeout Procedures - Punchlist", active: true },
  { code: "01 78 13", payrollId: "1781300", name: "Completion & Correction List", active: true },
  { code: "01 91 00", payrollId: "1910000", name: "Commissioning", active: true },
  { code: "03 30 02", payrollId: "3300200", name: "Poured Concrete Walls", active: true },
  { code: "03 31 00", payrollId: "3310000", name: "Structural Concrete", active: true },
  { code: "03 35 00", payrollId: "3350000", name: "Concrete Finishing", active: true },
  { code: "03 50 00", payrollId: "3500000", name: "Cast Decks and Underlayment", active: true },
  { code: "06 11 00", payrollId: "6110000", name: "Wood Framing", active: true },
  { code: "06 15 13", payrollId: "6151300", name: "Wood Floor Decking", active: true },
  { code: "06 15 16", payrollId: "6151600", name: "Wood Roof Decking", active: true },
  { code: "07 10 00", payrollId: "7100000", name: "Damp Proofing and Waterproofing", active: true },
  { code: "07 60 00", payrollId: "7600000", name: "Flashing and Sheet Metal", active: true },
  { code: "08 71 00", payrollId: "8710000", name: "Door Hardware", active: true },
  { code: "09 61 19", payrollId: "9611900", name: "Concrete Floor Staining", active: true },
  { code: "09 90 00", payrollId: "9900000", name: "Painting and Coating", active: true },
  { code: "09 91 23", payrollId: "9912300", name: "Interior Painting", active: true },
  { code: "10 28 16", payrollId: "10281600", name: "Bath Accessories", active: true },
  { code: "31 21 13", payrollId: "31211300", name: "Radon Mitigation", active: true },
  { code: "31 22 13", payrollId: "31221300", name: "Rough Grading", active: true },
  { code: "31 22 19", payrollId: "31221900", name: "Finish Grading", active: true },
  { code: "31 23 00", payrollId: "31230000", name: "Excavation and Fill", active: true },
  { code: "31 23 16", payrollId: "31231600", name: "Excavation", active: true },
  { code: "31 23 16.13", payrollId: "31231613", name: "Trenching Gas/Electric/Water", active: true },
  { code: "31 23 23.13", payrollId: "31232313", name: "Backfill", active: true },
  { code: "31 23 23.23", payrollId: "31232323", name: "Compaction", active: true },
  { code: "31 23 33", payrollId: "31233300", name: "Trenching and Backfilling", active: true },
  { code: "31 25 00", payrollId: "31250000", name: "Erosion and Sedimentation Controls", active: true },
]
