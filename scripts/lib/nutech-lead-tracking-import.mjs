import { createHash } from "node:crypto"

/**
 * Plans the one-time import of Nu-Tech jobs from the legacy Project Lead
 * Tracking workbook (Master List, Active Estimate Tracker, PO Master List)
 * into Compass projects. Pure: takes parsed rows, returns the planned writes
 * and a report; the CLI turns the plan into reviewable SQL.
 */

/** Tracker status codes ("E - Estimate in Progress") to Compass job statuses. */
export const TRACKER_STATUS_CODES = {
  I: "intake",
  PS: "price_sheet_sent",
  BE: "budget_estimating",
  BES: "budget_estimate_sent",
  E: "estimating",
  ES: "estimate_sent",
  W: "awaiting_response",
  F: "follow_up",
  DPN: "design_proposal",
  P: "awaiting_payment",
  O: "ordered",
  BO: "bracing_out",
  IP: "under_construction",
  CE: "contract_docs_signed",
  AG: "awaiting_groundbreaking",
  C: "complete",
  IA: "inactive",
  R: "bid_refused",
}

const CLOSED_STATUSES = new Set(["complete", "inactive", "bid_refused", "closed"])
const CUSTOMER_STATUSES = new Set([
  "awaiting_payment", "ordered", "bracing_out", "under_construction", "complete",
])

const MASTER = {
  number: 0, intakeDate: 10, assignedTo: 11, status: 13, lastUpdate: 14,
  company: 17, lastName: 18, firstName: 19, phone: 20, email: 21,
  streetNumber: 22, streetName: 23, cityStateZip: 24, referredBy: 26,
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

/** "N-998-1398-Kelsey Ct.-Tanner Bellino" or "N-998-1398" → "N-998-1398". */
export function projectNumberIn(value) {
  const match = /\bN-(\d+)-([A-Z0-9]+)\b/i.exec(text(value))
  return match ? `N-${Number(match[1])}-${match[2].toUpperCase()}` : null
}

function sequenceKey(projectNumber) {
  const match = /^N-(\d+)/i.exec(projectNumber)
  return match ? `N-${Number(match[1])}` : projectNumber.toUpperCase()
}

/** US dates as written in the sheet (9/23/2026 or 9/23/26) → ISO date. */
export function sheetDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text(value))
  if (!match) return null
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function trackerStatus(value) {
  const code = text(value).split(" - ")[0]?.trim().toUpperCase() ?? ""
  return TRACKER_STATUS_CODES[code] ?? null
}

/** Street address when the sheet has a real house number, else the town line. */
export function trackerAddress(row) {
  const number = text(row[MASTER.streetNumber])
  const street = text(row[MASTER.streetName])
  const town = text(row[MASTER.cityStateZip])
  const hasNumber = /\d/.test(number) && Number(number.replace(/\D/g, "")) > 0
  const streetLine = hasNumber && street ? `${number} ${street}` : null
  const parts = [streetLine, town].filter((part) => part)
  return parts.length > 0 ? parts.join(", ") : null
}

function clientName(row) {
  const person = [text(row[MASTER.firstName]), text(row[MASTER.lastName])].filter(Boolean).join(" ")
  return person || text(row[MASTER.company]) || null
}

function projectName(row, projectNumber) {
  const last = text(row[MASTER.lastName]) || text(row[MASTER.company])
  return last ? `${last} Fox Blocks` : projectNumber
}

function recordStatus(jobStatusId) {
  if (jobStatusId === "complete" || jobStatusId === "closed") return "COMPLETE"
  if (CLOSED_STATUSES.has(jobStatusId)) return "INACTIVE"
  return "OPEN"
}

/** Stable per project number, so a re-run plans the same ids. */
export function importedProjectId(projectNumber) {
  const hash = createHash("sha1").update(`nutech-lead-tracking:${projectNumber}`).digest("hex")
  return `proj-${projectNumber.toLowerCase()}-${hash.slice(0, 8)}`
}

function laterDate(a, b) {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

/**
 * @param input.masterRows Master List rows (header rows removed)
 * @param input.activity [{ text, date }] estimate-request and PO rows naming a job
 * @param input.existing Compass Nu-Tech projects: { id, projectNumber, jobStatusId,
 *   address, clientName, projectManager, statusChangedInCompass, intakeDate }
 *   (intakeDate: when the project was created through the Compass form, else null)
 * @param input.staffNames first name → Compass display name
 * @param input.asOf ISO date the 12-month window ends on
 */
export function planNutechImport(input) {
  const cutoff = new Date(`${input.asOf}T00:00:00Z`)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - (input.activeMonths ?? 12))
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const lastActivity = new Map()
  for (const entry of input.activity) {
    const number = projectNumberIn(entry.text)
    const date = sheetDate(entry.date)
    if (number && date) {
      const key = sequenceKey(number)
      lastActivity.set(key, laterDate(lastActivity.get(key) ?? null, date))
    }
  }

  // Later rows win when a number appears twice.
  const rowsByNumber = new Map()
  for (const row of input.masterRows) {
    const number = projectNumberIn(row[MASTER.number])
    if (number) rowsByNumber.set(sequenceKey(number), { number, row })
  }
  const existingBySequence = new Map(
    input.existing
      .filter((project) => project.projectNumber)
      .map((project) => [sequenceKey(project.projectNumber), project]),
  )

  const inserts = []
  const updates = []
  const report = { active: 0, stale: 0, closed: 0, unchanged: 0, keptCompassStatus: [], unknownStatus: [] }

  for (const [key, { number, row }] of rowsByNumber) {
    const sheetStatus = trackerStatus(row[MASTER.status])
    if (!sheetStatus && text(row[MASTER.status])) report.unknownStatus.push(`${number}: ${text(row[MASTER.status])}`)
    const mapped = sheetStatus ?? "intake"
    const existing = existingBySequence.get(key)
    const activity = [
      sheetDate(row[MASTER.intakeDate]),
      sheetDate(row[MASTER.lastUpdate]),
      lastActivity.get(key) ?? null,
      existing?.intakeDate ?? null,
    ].reduce(laterDate, null)
    const closed = CLOSED_STATUSES.has(mapped)
    const stale = !closed && (!activity || activity < cutoffDate)
    const jobStatusId = stale ? "inactive" : mapped
    if (closed) report.closed += 1
    else if (stale) report.stale += 1
    else report.active += 1

    const note = {
      source: "Project Lead Tracking",
      sheetStatus: text(row[MASTER.status]) || null,
      lastActivity: activity,
      importedAsStale: stale,
    }
    const fields = {
      address: trackerAddress(row),
      clientName: clientName(row),
      projectManager: input.staffNames[text(row[MASTER.assignedTo])] ?? (text(row[MASTER.assignedTo]) || null),
    }
    if (existing) {
      const set = {}
      if (existing.statusChangedInCompass) {
        if (existing.jobStatusId !== jobStatusId) report.keptCompassStatus.push(`${existing.projectNumber}: kept ${existing.jobStatusId} (sheet ${jobStatusId})`)
      } else if (existing.jobStatusId !== jobStatusId) {
        set.jobStatusId = jobStatusId
        set.status = recordStatus(jobStatusId)
      }
      for (const [field, value] of Object.entries(fields)) {
        if (value && !existing[field]) set[field] = value
      }
      if (Object.keys(set).length === 0) report.unchanged += 1
      else updates.push({ id: existing.id, projectNumber: existing.projectNumber, before: existing, set, note })
      continue
    }
    inserts.push({
      id: importedProjectId(number),
      projectNumber: number,
      name: projectName(row, number),
      jobStatusId,
      status: recordStatus(jobStatusId),
      clientStatus: CUSTOMER_STATUSES.has(mapped) ? "customer" : "lead",
      createdAt: sheetDate(row[MASTER.intakeDate]) ?? input.asOf,
      ...fields,
      note,
    })
  }

  return { cutoffDate, inserts, updates, report }
}
