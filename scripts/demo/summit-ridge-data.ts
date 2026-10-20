/**
 * Summit Ridge Builders: the made-up company on the demo copy of Compass
 * (demo.openrangeconstruction.ltd). Every name, address, phone number and
 * email here is fictional; phone numbers use the reserved 555-01xx range and
 * emails the reserved .example domain. Never put real customer data here.
 *
 * Dates are offsets in work days from the day the seed is built, so the
 * sample jobs always look current.
 */

export type DepartmentCode = "O" | "H" | "N" | "D"

export type SampleUser = {
  readonly key: string
  readonly firstName: string
  readonly lastName: string
  readonly jobTitle: string
  /** Org role: admin, office or field. */
  readonly role: "admin" | "office" | "field"
}

export const COMPANY = {
  id: "summit-ridge-builders",
  name: "Summit Ridge Builders",
  slug: "summit-ridge",
  emailDomain: "summitridge.example",
  town: "Cedar Bluff, CO 80999",
} as const

export const STAFF: readonly SampleUser[] = [
  { key: "dana", firstName: "Dana", lastName: "Whitfield", jobTitle: "Owner", role: "admin" },
  { key: "marcus", firstName: "Marcus", lastName: "Reyes", jobTitle: "Project Manager", role: "office" },
  { key: "priya", firstName: "Priya", lastName: "Nandakumar", jobTitle: "Designer & Estimator", role: "office" },
  { key: "tess", firstName: "Tess", lastName: "Okafor", jobTitle: "Office Manager", role: "office" },
  { key: "cole", firstName: "Cole", lastName: "Brennan", jobTitle: "Superintendent", role: "field" },
  { key: "luis", firstName: "Luis", lastName: "Ortega", jobTitle: "Crew Lead", role: "field" },
]

export type DepartmentProfileSeed = {
  readonly shortName: string
  readonly displayName: string
  readonly description: string
  readonly legalName: string
  readonly email: string
  readonly telephone: string
}

export const DEPARTMENTS: Readonly<Record<DepartmentCode, DepartmentProfileSeed>> = {
  O: {
    shortName: "Homes",
    displayName: "Summit Ridge Homes",
    description: "Custom homes, additions and remodels built for owners.",
    legalName: "Summit Ridge Builders LLC dba Summit Ridge Homes",
    email: "homes@summitridge.example",
    telephone: "719-555-0140",
  },
  H: {
    shortName: "Structures",
    displayName: "Summit Ridge Structures",
    description: "ICF foundations and framing packages for other builders.",
    legalName: "Summit Ridge Builders LLC",
    email: "structures@summitridge.example",
    telephone: "719-555-0141",
  },
  N: {
    shortName: "Supply",
    displayName: "Ridgeline Supply",
    description: "ICF block, bracing rental and building materials.",
    legalName: "Summit Ridge Builders LLC dba Ridgeline Supply",
    email: "supply@summitridge.example",
    telephone: "719-555-0142",
  },
  D: {
    shortName: "Design",
    displayName: "Summit Ridge Design",
    description: "House plans, drafting and permit sets.",
    legalName: "Summit Ridge Builders LLC dba Summit Ridge Design",
    email: "design@summitridge.example",
    telephone: "719-555-0143",
  },
}

export type SampleCompany = {
  readonly key: string
  readonly name: string
  readonly category: "Subcontractor" | "Supplier"
  readonly trade: string
  readonly contact: string
  readonly phone: string
}

export const VENDORS: readonly SampleCompany[] = [
  { key: "excavation", name: "Pinecrest Excavation", category: "Subcontractor", trade: "Excavation", contact: "Hank Moller", phone: "719-555-0150" },
  { key: "plumbing", name: "Blue Spruce Plumbing", category: "Subcontractor", trade: "Plumbing", contact: "Rosa Delgado", phone: "719-555-0151" },
  { key: "electric", name: "High Line Electric", category: "Subcontractor", trade: "Electrical", contact: "Wes Tanaka", phone: "719-555-0152" },
  { key: "hvac", name: "Frontier Heating & Air", category: "Subcontractor", trade: "HVAC", contact: "Glenn Pruitt", phone: "719-555-0153" },
  { key: "concrete", name: "Front Range Ready Mix", category: "Supplier", trade: "Concrete", contact: "Dispatch", phone: "719-555-0154" },
  { key: "lumber", name: "Timberline Lumber Co.", category: "Supplier", trade: "Lumber", contact: "Jill Akers", phone: "719-555-0155" },
  { key: "windows", name: "Clearview Window Supply", category: "Supplier", trade: "Windows & doors", contact: "Sam Whitley", phone: "719-555-0156" },
  { key: "roofing", name: "Ridgetop Roofing", category: "Subcontractor", trade: "Roofing", contact: "Arlo Benson", phone: "719-555-0157" },
]

export type ScheduleSeed = {
  readonly title: string
  readonly phase: string
  /** Work days from today; negative is in the past. */
  readonly start: number
  readonly workdays: number
  readonly status: "COMPLETE" | "IN_PROGRESS" | "PENDING"
  readonly percent?: number
  readonly milestone?: boolean
  readonly critical?: boolean
  readonly assignee?: string
  /** Vendor key for a sub-visible task. */
  readonly vendor?: string
}

export type LogSeed = {
  /** Work days ago. */
  readonly daysAgo: number
  readonly author: string
  readonly weather: string
  readonly tempF: number
  readonly crew: string
  readonly hours: number
  readonly completed: string
  readonly issues?: string
  readonly notes?: string
  readonly visitors?: string
}

export type TodoSeed = {
  readonly title: string
  readonly type: "staff_task" | "subcontractor_task" | "supplier_task"
  readonly status: "open" | "in_progress" | "blocked" | "complete"
  readonly priority?: "high" | "normal"
  readonly assignee: string
  /** Work days from today. */
  readonly due: number
  /** Index into the project's logs this to-do was made from. */
  readonly fromLog?: number
  readonly note?: string
}

export type InteractionSeed = {
  readonly daysAgo: number
  readonly type: "call" | "email" | "meeting" | "text"
  readonly direction: "inbound" | "outbound"
  readonly by: string
  readonly summary: string
}

export type ProjectSeed = {
  readonly key: string
  readonly department: DepartmentCode
  readonly number: string
  readonly name: string
  readonly jobStatusId: string
  readonly street: string
  readonly city: string
  readonly client: { readonly name: string; readonly company?: string; readonly phone: string }
  readonly manager: string
  readonly crew: readonly string[]
  readonly vendors: readonly string[]
  readonly schedule: readonly ScheduleSeed[]
  readonly logs: readonly LogSeed[]
  readonly todos: readonly TodoSeed[]
  readonly interactions: readonly InteractionSeed[]
  readonly note?: string
}

export const PROJECTS: readonly ProjectSeed[] = [
  {
    key: "hartwell",
    department: "O",
    number: "O-101",
    name: "O-101-2140-Hartwell",
    jobStatusId: "under_construction",
    street: "2140 Aspen Meadow Dr",
    city: "Cedar Bluff, CO 80999",
    client: { name: "Ben & Clara Hartwell", phone: "719-555-0170" },
    manager: "marcus",
    crew: ["cole", "luis"],
    vendors: ["excavation", "concrete", "lumber", "plumbing", "electric", "hvac", "windows", "roofing"],
    note: "3,100 sq ft two-story with walkout basement. Owners want weekly photo updates.",
    schedule: [
      { title: "Permit issued", phase: "Preconstruction", start: -38, workdays: 1, status: "COMPLETE", milestone: true },
      { title: "Excavation & footings", phase: "Foundation", start: -36, workdays: 5, status: "COMPLETE", vendor: "excavation" },
      { title: "ICF foundation walls", phase: "Foundation", start: -30, workdays: 6, status: "COMPLETE", assignee: "cole", critical: true },
      { title: "Foundation inspection", phase: "Foundation", start: -23, workdays: 1, status: "COMPLETE", milestone: true },
      { title: "Backfill & under-slab plumbing", phase: "Foundation", start: -22, workdays: 3, status: "COMPLETE", vendor: "plumbing" },
      { title: "Basement slab pour", phase: "Foundation", start: -18, workdays: 1, status: "COMPLETE", vendor: "concrete" },
      { title: "Main floor framing", phase: "Framing", start: -16, workdays: 8, status: "COMPLETE", assignee: "luis", critical: true },
      { title: "Upper floor & roof framing", phase: "Framing", start: -7, workdays: 9, status: "IN_PROGRESS", percent: 70, assignee: "luis", critical: true },
      { title: "Window & exterior door install", phase: "Dry-in", start: 2, workdays: 3, status: "PENDING", vendor: "windows" },
      { title: "Roofing", phase: "Dry-in", start: 3, workdays: 4, status: "PENDING", vendor: "roofing", critical: true },
      { title: "Plumbing rough-in", phase: "Rough-ins", start: 7, workdays: 5, status: "PENDING", vendor: "plumbing" },
      { title: "Electrical rough-in", phase: "Rough-ins", start: 8, workdays: 6, status: "PENDING", vendor: "electric" },
      { title: "HVAC rough-in", phase: "Rough-ins", start: 9, workdays: 5, status: "PENDING", vendor: "hvac" },
      { title: "Rough inspections", phase: "Rough-ins", start: 15, workdays: 1, status: "PENDING", milestone: true, critical: true },
      { title: "Insulation & drywall", phase: "Interior", start: 17, workdays: 12, status: "PENDING" },
      { title: "Cabinets & trim", phase: "Interior", start: 30, workdays: 10, status: "PENDING" },
      { title: "Final walkthrough with owners", phase: "Closeout", start: 55, workdays: 1, status: "PENDING", milestone: true, assignee: "marcus" },
    ],
    logs: [
      { daysAgo: 6, author: "cole", weather: "Sunny", tempF: 58, crew: "Cole, Luis, 3 framers", hours: 40, completed: "Set upper floor joists on the north half. Sheathed the deck over the great room.", notes: "Order LVL for the garage header\nConfirm window delivery date with Clearview" },
      { daysAgo: 5, author: "luis", weather: "Partly cloudy", tempF: 54, crew: "Luis, 3 framers", hours: 32, completed: "Finished upper floor deck. Started bedroom wall layout.", issues: "Two joists on the south side are crowned more than 3/8 inch" },
      { daysAgo: 4, author: "cole", weather: "Windy", tempF: 49, crew: "Cole, Luis, 3 framers", hours: 36, completed: "Stood upper floor exterior walls on the east and south. Replaced the two crowned joists.", visitors: "Ben Hartwell (owner) walked the upper floor at lunch" },
      { daysAgo: 3, author: "luis", weather: "Snow flurries, stopped by 10", tempF: 34, crew: "Luis, 2 framers", hours: 20, completed: "Late start for snow. Interior walls on the upper floor.", issues: "Wind gusts over 35 mph after 2 PM, stopped setting sheathing", notes: "Tarp the stair opening before the weekend" },
      { daysAgo: 2, author: "cole", weather: "Sunny", tempF: 52, crew: "Cole, Luis, 3 framers", hours: 40, completed: "Set roof trusses with the crane. Braced and started truss blocking.", visitors: "Truss delivery driver, crane operator" },
      { daysAgo: 1, author: "luis", weather: "Sunny", tempF: 57, crew: "Luis, 3 framers", hours: 38, completed: "Roof sheathing about 60% done. Fascia on the front gable.", notes: "Need roofers on site by Thursday\nWalk the electrical layout with High Line before rough-in" },
    ],
    todos: [
      { title: "Order LVL for the garage header", type: "staff_task", status: "complete", assignee: "marcus", due: -4, fromLog: 0 },
      { title: "Confirm window delivery date with Clearview", type: "supplier_task", status: "in_progress", assignee: "windows", due: 1, fromLog: 0, note: "Clearview says Tuesday, waiting on written confirmation" },
      { title: "Two joists on the south side are crowned more than 3/8 inch", type: "staff_task", status: "complete", priority: "high", assignee: "cole", due: -4, fromLog: 1 },
      { title: "Tarp the stair opening before the weekend", type: "staff_task", status: "open", assignee: "luis", due: 0, fromLog: 3 },
      { title: "Need roofers on site by Thursday", type: "subcontractor_task", status: "open", priority: "high", assignee: "roofing", due: 3, fromLog: 5 },
      { title: "Walk the electrical layout with High Line before rough-in", type: "subcontractor_task", status: "open", assignee: "electric", due: 6, fromLog: 5 },
      { title: "Owners to pick exterior stone by Friday", type: "staff_task", status: "blocked", assignee: "marcus", due: 4, note: "Waiting on the owners to visit the stone yard" },
    ],
    interactions: [
      { daysAgo: 4, type: "meeting", direction: "inbound", by: "cole", summary: "Ben walked the upper floor and asked about moving the laundry closet 2 feet. Told him we would price it." },
      { daysAgo: 2, type: "email", direction: "outbound", by: "marcus", summary: "Sent the weekly update with truss photos and the roofing start date." },
    ],
  },
  {
    key: "lindqvist",
    department: "O",
    number: "O-102",
    name: "O-102-58-Lindqvist",
    jobStatusId: "permitting",
    street: "58 Willow Bend Ct",
    city: "Cedar Bluff, CO 80999",
    client: { name: "Erik Lindqvist", phone: "719-555-0171" },
    manager: "marcus",
    crew: ["cole"],
    vendors: ["excavation", "concrete", "lumber"],
    note: "Kitchen remodel and 400 sq ft family room addition.",
    schedule: [
      { title: "Contract signed", phase: "Preconstruction", start: -12, workdays: 1, status: "COMPLETE", milestone: true },
      { title: "Permit review", phase: "Preconstruction", start: -10, workdays: 15, status: "IN_PROGRESS", percent: 50, assignee: "tess" },
      { title: "Demo kitchen", phase: "Demolition", start: 6, workdays: 3, status: "PENDING", assignee: "cole" },
      { title: "Addition footings", phase: "Foundation", start: 9, workdays: 4, status: "PENDING", vendor: "excavation" },
      { title: "Addition framing", phase: "Framing", start: 14, workdays: 6, status: "PENDING" },
    ],
    logs: [],
    todos: [
      { title: "Answer the county's comment on the addition setback", type: "staff_task", status: "in_progress", priority: "high", assignee: "priya", due: 2 },
      { title: "Order kitchen cabinets (8-week lead time)", type: "staff_task", status: "open", assignee: "marcus", due: 5 },
    ],
    interactions: [
      { daysAgo: 3, type: "call", direction: "outbound", by: "marcus", summary: "Told Erik the county asked for a setback clarification; expect permit in about two weeks." },
    ],
  },
  {
    key: "copperline",
    department: "H",
    number: "H-201",
    name: "H-201-3315-Copperline",
    jobStatusId: "under_construction",
    street: "3315 Granite Ridge Rd",
    city: "Cedar Bluff, CO 80999",
    client: { name: "Copperline Homes", company: "Copperline Homes", phone: "719-555-0172" },
    manager: "dana",
    crew: ["luis"],
    vendors: ["concrete"],
    note: "ICF foundation subcontract for Copperline's spec home. We supply labor and bracing; they supply block.",
    schedule: [
      { title: "Footings ready (by Copperline)", phase: "Foundation", start: -5, workdays: 1, status: "COMPLETE", milestone: true },
      { title: "Stack ICF walls", phase: "Foundation", start: -4, workdays: 4, status: "IN_PROGRESS", percent: 80, assignee: "luis", critical: true },
      { title: "Pre-pour inspection", phase: "Foundation", start: 1, workdays: 1, status: "PENDING", milestone: true },
      { title: "Wall pour", phase: "Foundation", start: 2, workdays: 1, status: "PENDING", vendor: "concrete", critical: true },
      { title: "Strip bracing and haul back", phase: "Foundation", start: 5, workdays: 1, status: "PENDING", assignee: "luis" },
    ],
    logs: [
      { daysAgo: 3, author: "luis", weather: "Sunny", tempF: 55, crew: "Luis, 2 laborers", hours: 24, completed: "Stacked courses 1-4 on all walls. Set rebar in the corners." },
      { daysAgo: 2, author: "luis", weather: "Partly cloudy", tempF: 51, crew: "Luis, 2 laborers", hours: 24, completed: "Courses 5-8. Bucked the basement window openings.", issues: "Copperline's block delivery was 40 blocks short" },
      { daysAgo: 1, author: "luis", weather: "Sunny", tempF: 56, crew: "Luis, 2 laborers", hours: 24, completed: "Courses 9-10 and bracing set on all walls.", notes: "Book the pump truck for the pour" },
    ],
    todos: [
      { title: "Copperline's block delivery was 40 blocks short", type: "staff_task", status: "complete", priority: "high", assignee: "dana", due: -1, fromLog: 1 },
      { title: "Book the pump truck for the pour", type: "supplier_task", status: "open", assignee: "concrete", due: 1, fromLog: 2 },
    ],
    interactions: [],
  },
  {
    key: "mesa",
    department: "H",
    number: "H-202",
    name: "H-202-907-Mesa Vista",
    jobStatusId: "estimate_sent",
    street: "907 Mesa Vista Ln",
    city: "Cedar Bluff, CO 80999",
    client: { name: "Mesa Vista Development", company: "Mesa Vista Development", phone: "719-555-0173" },
    manager: "priya",
    crew: [],
    vendors: ["lumber"],
    note: "Framing package bid for a 6-unit townhome building.",
    schedule: [],
    logs: [],
    todos: [
      { title: "Follow up on framing bid", type: "staff_task", status: "open", assignee: "priya", due: 2 },
    ],
    interactions: [
      { daysAgo: 5, type: "email", direction: "outbound", by: "priya", summary: "Sent framing bid for all 6 units, good for 30 days." },
    ],
  },
  {
    key: "kowalski",
    department: "N",
    number: "N-301",
    name: "N-301-1180-Kowalski",
    jobStatusId: "bracing_out",
    street: "1180 Elk Run Trl",
    city: "Cedar Bluff, CO 80999",
    client: { name: "Kowalski Construction", company: "Kowalski Construction", phone: "719-555-0174" },
    manager: "tess",
    crew: [],
    vendors: [],
    note: "Sold 620 ICF block and rented 14 wall braces for a basement. Braces due back in 3 weeks.",
    schedule: [
      { title: "Block delivered", phase: "Delivery", start: -8, workdays: 1, status: "COMPLETE", milestone: true },
      { title: "Bracing on rent", phase: "Rental", start: -8, workdays: 23, status: "IN_PROGRESS", percent: 35 },
      { title: "Bracing return due", phase: "Rental", start: 15, workdays: 1, status: "PENDING", milestone: true },
    ],
    logs: [],
    todos: [
      { title: "Invoice the second rental week", type: "staff_task", status: "open", assignee: "tess", due: 1 },
    ],
    interactions: [
      { daysAgo: 6, type: "call", direction: "inbound", by: "tess", summary: "Kowalski asked to add 4 corner blocks; added to the delivery." },
    ],
  },
  {
    key: "prescott",
    department: "D",
    number: "D-401",
    name: "D-401-44-Prescott",
    jobStatusId: "in_design",
    street: "44 Juniper Hollow",
    city: "Cedar Bluff, CO 80999",
    client: { name: "Nora Prescott", phone: "719-555-0175" },
    manager: "priya",
    crew: [],
    vendors: [],
    note: "Plans for a 1,800 sq ft mountain cabin. Owner may build with us after permit.",
    schedule: [
      { title: "Design proposal signed", phase: "Design", start: -20, workdays: 1, status: "COMPLETE", milestone: true },
      { title: "Site visit & survey review", phase: "Design", start: -18, workdays: 2, status: "COMPLETE", assignee: "priya" },
      { title: "Schematic floor plans", phase: "Design", start: -15, workdays: 10, status: "COMPLETE", assignee: "priya" },
      { title: "Owner review meeting", phase: "Design", start: -4, workdays: 1, status: "COMPLETE", milestone: true },
      { title: "Construction drawings", phase: "Drafting", start: -3, workdays: 15, status: "IN_PROGRESS", percent: 20, assignee: "priya" },
      { title: "Permit set issued", phase: "Drafting", start: 13, workdays: 1, status: "PENDING", milestone: true },
    ],
    logs: [],
    todos: [
      { title: "Move the mudroom to the north side per owner review", type: "staff_task", status: "in_progress", assignee: "priya", due: 3 },
      { title: "Get truss engineering quote", type: "staff_task", status: "open", assignee: "priya", due: 8 },
    ],
    interactions: [
      { daysAgo: 4, type: "meeting", direction: "inbound", by: "priya", summary: "Owner review of schematic plans. Nora approved the layout with the mudroom moved to the north side." },
    ],
  },
]

export const CHANNEL_MESSAGES: readonly { readonly by: string; readonly daysAgo: number; readonly text: string }[] = [
  { by: "dana", daysAgo: 4, text: "Welcome to Summit Ridge on Compass! Post jobsite questions here or on each job's page." },
  { by: "cole", daysAgo: 2, text: "Trusses are set on Hartwell. Roofers need to be there Thursday." },
  { by: "tess", daysAgo: 1, text: "Kowalski's braces are out for three more weeks. I'll send this week's rental invoice Friday." },
]
