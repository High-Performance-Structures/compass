import { execFileSync } from "node:child_process"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const PROJECT_ID = "proj-bt-o-197-litten"

const CATEGORY_COST_CODES = [
  ["Appliances", "11 30 13"],
  ["Attachments", "07 72 00"],
  ["Baseboards and Trim", "06 20 00"],
  ["Cabinetry & Shelving & Countertops", "12 35 30"],
  ["Electrical", "26 00 00"],
  ["Electrical Fixtures", "26 00 00"],
  ["Entry Doors and Hardware", "08 71 00"],
  ["FIXTURES", "22 40 00"],
  ["Floor Finish", "09 60 00"],
  ["Miscellaneous", "10 00 00"],
  ["Plumbing Fixtures", "22 40 00"],
  ["Veneer", "09 24 23"],
  ["Wall Finish", "09 90 00"],
]

const NAME_COST_CODES = [
  ["Chimney Cap(s)", "07 72 00"],
  ["Dishwasher", "11 30 13"],
  ["Door Casing", "06 20 00"],
  ["Door Hinges", "08 71 00"],
  ["Drywall Texture", "09 29 00"],
  ["Hardware", "08 71 00"],
  ["Hosebibs", "22 40 00"],
  ["Kitchen Sink", "22 40 00"],
  ["Paint 1 (Wall)", "09 90 00"],
  ["Paint 2 (Ceiling)", "09 90 00"],
  ["Range Hood", "11 30 13"],
  ["Refrigerator", "11 30 13"],
  ["Roofing (Barrel)", "07 32 00"],
  ["Roofing (Main)", "07 30 00"],
  ["Stovetop", "11 30 13"],
  ["Stucco (w/ Pop-outs?)", "09 24 23"],
  ["Stucco Accent", "09 24 23"],
  ["Stucco Trim", "09 24 23"],
  ["Windows", "08 50 00"],
]

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function updateBy(column, pairs) {
  return pairs
    .map(([value, costCode]) => {
      return [
        "update project_finish_selections",
        `set cost_code = ${sqlString(costCode)}, updated_at = datetime('now')`,
        `where project_id = ${sqlString(PROJECT_ID)}`,
        `and ${column} = ${sqlString(value)};`,
      ].join(" ")
    })
    .join("\n")
}

const countBefore = execFileSync(
  "sqlite3",
  [
    DB_PATH,
    `select count(*) from project_finish_selections where project_id=${sqlString(
      PROJECT_ID
    )} and coalesce(cost_code,'') <> '';`,
  ],
  { encoding: "utf8" }
).trim()

execFileSync(
  "sqlite3",
  [DB_PATH],
  {
    input: [
      "begin;",
      updateBy("category", CATEGORY_COST_CODES),
      updateBy("name", NAME_COST_CODES),
      "commit;",
    ].join("\n"),
  }
)

const countAfter = execFileSync(
  "sqlite3",
  [
    DB_PATH,
    `select count(*) from project_finish_selections where project_id=${sqlString(
      PROJECT_ID
    )} and coalesce(cost_code,'') <> '';`,
  ],
  { encoding: "utf8" }
).trim()

console.log(
  JSON.stringify(
    {
      dbPath: DB_PATH,
      projectId: PROJECT_ID,
      codedBefore: Number(countBefore),
      codedAfter: Number(countAfter),
    },
    null,
    2
  )
)
