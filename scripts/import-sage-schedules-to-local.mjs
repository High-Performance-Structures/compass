#!/usr/bin/env node
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import Database from "better-sqlite3"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const NOW = new Date().toISOString()

const IMPORTS = [
  {
    projectId: "proj-o-170-loomis",
    jsonPath:
      ".codex-snapshots/sage-schedule-import/o-170-loomis-schedule-full-structure-key-2026.json",
  },
  {
    projectId: "proj-o-202-loeffler",
    jsonPath:
      ".codex-snapshots/sage-schedule-import/o-202-loeffler-schedule-full-structure.json",
  },
]

function stableId(parts) {
  return createHash("sha1").update(parts.join(":")).digest("hex").slice(0, 24)
}

function readSchedule(path) {
  const file = readFileSync(resolve(process.cwd(), path), "utf8")
  return JSON.parse(file)
}

function dateOnly(value) {
  if (typeof value !== "string") return null
  return value.slice(0, 10)
}

function statusFor(task) {
  if (task.isComplete === true || Number(task.percentComplete) >= 100) {
    return "COMPLETE"
  }
  if (Number(task.percentComplete) > 0) {
    return "IN_PROGRESS"
  }
  return "PENDING"
}

function assignedToFor(task) {
  if (!Array.isArray(task.assignedTo) || task.assignedTo.length === 0) {
    return null
  }
  return task.assignedTo.filter(Boolean).join(" ")
}

function phaseFor(task) {
  if (typeof task.phase === "string" && task.phase.trim().length > 0) {
    return task.phase.trim()
  }
  return "Unassigned / General"
}

function isMilestone(task) {
  const title = typeof task.title === "string" ? task.title.toLowerCase() : ""
  return (
    Number(task.durationDays) <= 1 &&
    (title.includes("inspection") ||
      title.includes("walk") ||
      title.includes("certificate") ||
      title.includes("ceremony") ||
      title.includes("complete"))
  )
}

function importSchedule(db, importDef) {
  const schedule = readSchedule(importDef.jsonPath)
  const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : []
  const idBySourceTaskId = new Map()

  const project = db
    .prepare("SELECT id, name, project_number FROM projects WHERE id = ?")
    .get(importDef.projectId)
  if (!project) {
    throw new Error(`Project not found in local Compass DB: ${importDef.projectId}`)
  }

  const existingTaskIds = db
    .prepare("SELECT id FROM schedule_tasks WHERE project_id = ?")
    .all(importDef.projectId)
    .map((row) => row.id)

  if (existingTaskIds.length > 0) {
    const deleteDependencies = db.prepare(
      `DELETE FROM task_dependencies
       WHERE predecessor_id IN (${existingTaskIds.map(() => "?").join(",")})
          OR successor_id IN (${existingTaskIds.map(() => "?").join(",")})`
    )
    deleteDependencies.run(...existingTaskIds, ...existingTaskIds)
  }

  db.prepare("DELETE FROM schedule_tasks WHERE project_id = ?").run(
    importDef.projectId
  )

  const insertTask = db.prepare(
    `INSERT INTO schedule_tasks (
      id, project_id, title, start_date, workdays, end_date_calculated,
      phase, status, is_critical_path, is_milestone, percent_complete,
      assigned_to, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  for (const task of tasks) {
    const sourceTaskId = String(task.sourceTaskId)
    const id = `sage-${importDef.projectId}-${sourceTaskId}`
    idBySourceTaskId.set(sourceTaskId, id)
    insertTask.run(
      id,
      importDef.projectId,
      String(task.title),
      dateOnly(task.start) || dateOnly(schedule.summary?.firstStart) || NOW.slice(0, 10),
      Math.max(1, Number(task.durationDays) || 1),
      dateOnly(task.end) || dateOnly(task.start) || NOW.slice(0, 10),
      phaseFor(task),
      statusFor(task),
      0,
      isMilestone(task) ? 1 : 0,
      Math.max(0, Math.min(100, Number(task.percentComplete) || 0)),
      assignedToFor(task),
      Number(task.sourceTaskId) || tasks.indexOf(task),
      NOW,
      NOW
    )
  }

  const insertDependency = db.prepare(
    `INSERT INTO task_dependencies (
      id, predecessor_id, successor_id, type, lag_days
    ) VALUES (?, ?, ?, ?, ?)`
  )

  let dependencyCount = 0
  for (const task of tasks) {
    const successorId = idBySourceTaskId.get(String(task.sourceTaskId))
    if (!successorId || !Array.isArray(task.predecessors)) continue

    for (const predecessor of task.predecessors) {
      const predecessorId = idBySourceTaskId.get(String(predecessor.sourceTaskId))
      if (!predecessorId) continue

      insertDependency.run(
        `sage-dep-${stableId([importDef.projectId, predecessorId, successorId, predecessor.type || "FS"])}`,
        predecessorId,
        successorId,
        String(predecessor.type || "FS").toUpperCase(),
        Number(predecessor.lagDays) || 0
      )
      dependencyCount += 1
    }
  }

  return {
    projectId: importDef.projectId,
    projectName: project.name,
    taskCount: tasks.length,
    dependencyCount,
    firstStart: schedule.summary?.firstStart,
    lastEnd: schedule.summary?.lastEnd,
  }
}

const db = new Database(DB_PATH)
db.pragma("foreign_keys = ON")

const run = db.transaction(() => IMPORTS.map((item) => importSchedule(db, item)))
const results = run()

console.log(JSON.stringify({ dbPath: DB_PATH, results }, null, 2))
