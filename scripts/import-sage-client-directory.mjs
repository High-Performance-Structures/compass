import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { XMLParser } from "fast-xml-parser"

import {
  buildSageClientDirectoryImportSql,
  stableSageClientDirectory,
} from "../src/lib/sage/client-directory-import.ts"

function text(value) {
  return value == null ? "" : String(value).trim()
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function sharedStringText(item) {
  if (!item) return ""
  if (item.t != null) return text(item.t)
  if (Array.isArray(item.r)) {
    return item.r.map((run) => text(run.t)).join("")
  }
  if (item.r) return text(item.r.t)
  return ""
}

function columnIndex(cellReference) {
  const letters = text(cellReference).replace(/[0-9]/g, "")
  let index = 0
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64
  }
  return index - 1
}

function unzipXml(filePath, entry) {
  return execFileSync("unzip", ["-p", filePath, entry], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
}

function workbookRows(filePath) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  })
  const shared = parser.parse(unzipXml(filePath, "xl/sharedStrings.xml"))
  const strings = asArray(shared.sst.si).map(sharedStringText)
  const sheet = parser.parse(
    unzipXml(filePath, "xl/worksheets/sheet1.xml")
  )
  return asArray(sheet.worksheet.sheetData.row).map((row) => {
    const cells = []
    for (const cell of asArray(row.c)) {
      const index = columnIndex(cell["@_r"])
      const rawValue = text(cell.v)
      cells[index] = cell["@_t"] === "s" ? strings[Number(rawValue)] ?? "" : rawValue
    }
    return cells
  })
}

export function parseSageClientList(filePath) {
  const rows = workbookRows(filePath)
  const records = []
  for (let index = 0; index < rows.length - 1; index += 1) {
    if (text(rows[index][0]) !== "Client#") continue
    const clientNumber = text(rows[index][2])
    const nextRow = rows[index + 1]
    if (text(nextRow[0]) !== "Client Name") continue
    const name = text(nextRow[2])
    if (clientNumber && name) records.push({ clientNumber, name })
  }
  return records
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? text(process.argv[index + 1]) : ""
}

function main() {
  const inputPath = argumentValue("--input")
  const organizationId = argumentValue("--organization-id")
  const outputPath = argumentValue("--output")
  if (!inputPath || !organizationId || !outputPath) {
    throw new Error(
      "Usage: bun scripts/import-sage-client-directory.mjs --input <SAGE-CLIENTLIST.xlsx> --organization-id <id> --output <import.sql>"
    )
  }

  const records = parseSageClientList(inputPath)
  const stable = stableSageClientDirectory(records)
  const sql = buildSageClientDirectoryImportSql({ organizationId, records })
  fs.writeFileSync(outputPath, sql, { encoding: "utf8", flag: "wx" })
  process.stdout.write(
    `${JSON.stringify({
      parsedRecords: records.length,
      stableRecords: stable.clients.length,
      conflictingClientNumbers: stable.conflictingClientNumbers,
      outputPath,
    })}\n`
  )
}

main()
