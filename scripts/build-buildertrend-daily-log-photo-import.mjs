#!/usr/bin/env bun

import { readFile, stat, writeFile } from "node:fs/promises"

function usage() {
  console.error(
    "Usage: bun scripts/build-buildertrend-daily-log-photo-import.mjs " +
      "--project-id id --daily-log-id id --buildertrend-daily-log-id id " +
      "--log-date YYYY-MM-DD --drive-result /absolute/result.json " +
      "--photo-count number --video-count number --output /absolute/import.sql"
  )
}

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "the end"}`)
    }
    values.set(key.slice(2), value)
  }

  const required = [
    "project-id",
    "daily-log-id",
    "buildertrend-daily-log-id",
    "log-date",
    "drive-result",
    "photo-count",
    "video-count",
    "output",
  ]
  for (const key of required) {
    if (!values.get(key)) throw new Error(`--${key} is required`)
  }

  const photoCount = Number.parseInt(values.get("photo-count"), 10)
  const videoCount = Number.parseInt(values.get("video-count"), 10)
  if (!Number.isInteger(photoCount) || photoCount < 0) {
    throw new Error("--photo-count must be a non-negative integer")
  }
  if (!Number.isInteger(videoCount) || videoCount < 0) {
    throw new Error("--video-count must be a non-negative integer")
  }

  return {
    projectId: values.get("project-id"),
    dailyLogId: values.get("daily-log-id"),
    buildertrendDailyLogId: values.get("buildertrend-daily-log-id"),
    logDate: values.get("log-date"),
    driveResult: values.get("drive-result"),
    photoCount,
    videoCount,
    output: values.get("output"),
  }
}

function sqlText(value) {
  if (value === null || value === undefined) return "NULL"
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlInteger(value) {
  return Number.isInteger(value) ? String(value) : "NULL"
}

function normalizedDriveFiles(payload) {
  if (!Array.isArray(payload.files)) {
    throw new Error("Drive result must contain a files array")
  }

  return payload.files.map((file, index) => {
    if (
      typeof file?.id !== "string" ||
      file.id.length === 0 ||
      typeof file?.name !== "string" ||
      file.name.length === 0 ||
      typeof file?.mimeType !== "string" ||
      !file.mimeType.startsWith("image/") ||
      typeof file?.webViewLink !== "string" ||
      file.webViewLink.length === 0
    ) {
      throw new Error(`Invalid image result at index ${index}`)
    }
    return file
  })
}

async function fileSize(file) {
  const path =
    typeof file.sourcePath === "string"
      ? file.sourcePath
      : typeof file.path === "string"
        ? file.path
        : null
  if (path === null) return null
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.logDate)) {
    throw new Error("--log-date must use YYYY-MM-DD")
  }

  const payload = JSON.parse(await readFile(options.driveResult, "utf8"))
  const files = normalizedDriveFiles(payload)
  if (files.length !== options.photoCount) {
    throw new Error(
      `Drive result has ${files.length} images; expected ${options.photoCount}`
    )
  }

  const now = new Date().toISOString()
  // Wrangler executes an imported SQL file atomically; explicit BEGIN/COMMIT
  // statements are rejected by the D1 file-import endpoint.
  const statements = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const size = await fileSize(file)
    const id = `bt-dl-photo-${options.buildertrendDailyLogId}-${file.id}`
    const thumbnailUrl = `/api/google/download/${file.id}`

    statements.push(
      "INSERT INTO daily_log_photos (" +
        "id, project_id, daily_log_id, uploaded_by, source_system, " +
        "source_external_id, file_name, file_size, mime_type, drive_file_id, " +
        "drive_url, thumbnail_url, caption, captured_at, gps_lat, gps_lng, " +
        "upload_status, review_status, owner_visible, sub_vendor_visible, " +
        "public_shareable, photo_kind, schedule_phase_override, sort_order, " +
        "created_at, updated_at" +
        ") VALUES (" +
        [
          sqlText(id),
          sqlText(options.projectId),
          sqlText(options.dailyLogId),
          "NULL",
          sqlText("buildertrend"),
          sqlText(file.id),
          sqlText(file.name),
          sqlInteger(size),
          sqlText(file.mimeType),
          sqlText(file.id),
          sqlText(file.webViewLink),
          sqlText(thumbnailUrl),
          "NULL",
          sqlText(options.logDate),
          "NULL",
          "NULL",
          sqlText("uploaded"),
          sqlText("needs_review"),
          "0",
          "0",
          "0",
          sqlText("progress"),
          "NULL",
          String(index),
          sqlText(now),
          sqlText(now),
        ].join(", ") +
        ") ON CONFLICT(id) DO UPDATE SET " +
        "project_id=excluded.project_id, daily_log_id=excluded.daily_log_id, " +
        "source_system=excluded.source_system, " +
        "source_external_id=excluded.source_external_id, " +
        "file_name=excluded.file_name, file_size=excluded.file_size, " +
        "mime_type=excluded.mime_type, drive_file_id=excluded.drive_file_id, " +
        "drive_url=excluded.drive_url, thumbnail_url=excluded.thumbnail_url, " +
        "captured_at=excluded.captured_at, upload_status=excluded.upload_status, " +
        "sort_order=excluded.sort_order, updated_at=excluded.updated_at;"
    )
  }

  statements.push(
    "UPDATE daily_logs SET tags=json_set(" +
      "CASE WHEN json_valid(tags) THEN tags ELSE '{}' END, " +
      `'$.buildertrendPhotoCount', ${options.photoCount}, ` +
      `'$.buildertrendVideoCount', ${options.videoCount}, ` +
      `'$.buildertrendMediaCount', ${options.photoCount + options.videoCount}, ` +
      `'$.buildertrendPhotosArchivedAt', ${sqlText(now)}` +
      `) WHERE id=${sqlText(options.dailyLogId)} ` +
      `AND project_id=${sqlText(options.projectId)};`
  )
  statements.push("")

  await writeFile(options.output, statements.join("\n"), "utf8")
  console.log(
    `Wrote ${files.length} idempotent photo rows for ${options.dailyLogId} to ${options.output}`
  )
}

main().catch((error) => {
  usage()
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
