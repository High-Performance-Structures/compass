import { getAccessToken } from "@/lib/google/auth/service-account"
import {
  GOOGLE_SHEETS_API,
  type ServiceAccountKey,
} from "@/lib/google/config"

type SheetsValueRenderOption =
  | "FORMATTED_VALUE"
  | "UNFORMATTED_VALUE"
  | "FORMULA"

export type GoogleSheetMetadata = {
  readonly sheetId: number
  readonly title: string
  readonly index: number
  readonly hidden: boolean
  readonly rowCount: number | null
}

export type GoogleSpreadsheetMetadata = {
  readonly title: string
  readonly sheets: readonly GoogleSheetMetadata[]
}

export type GoogleSheetAppendResult = {
  readonly updatedRange: string | null
}

export type GoogleSheetValueUpdate = {
  readonly range: string
  readonly values: ReadonlyArray<ReadonlyArray<unknown>>
}

export type GoogleSheetCreateResult = {
  readonly sheetId: number
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return isObjectRecord(value) ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export class SheetsClient {
  constructor(
    private readonly serviceAccountKey: ServiceAccountKey
  ) {}

  async getSpreadsheetMetadata(
    userEmail: string,
    spreadsheetId: string
  ): Promise<GoogleSpreadsheetMetadata> {
    const token = await getAccessToken(this.serviceAccountKey, userEmail)
    const params = new URLSearchParams({
      fields:
        "properties.title,sheets.properties(sheetId,title,index,hidden,gridProperties.rowCount)",
    })
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${spreadsheetId}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Google Sheets API error (${response.status}): ${body.slice(0, 500)}`
      )
    }

    const payload = objectValue(await response.json())
    const spreadsheetProperties = objectValue(payload?.properties)
    const sheetValues = Array.isArray(payload?.sheets) ? payload.sheets : []
    const sheets = sheetValues.flatMap((value) => {
      const sheet = objectValue(value)
      const properties = objectValue(sheet?.properties)
      const gridProperties = objectValue(properties?.gridProperties)
      const sheetId = numberValue(properties?.sheetId)
      const title = stringValue(properties?.title)
      const index = numberValue(properties?.index)
      if (sheetId === null || title === null || index === null) return []
      return [
        {
          sheetId,
          title,
          index,
          hidden: properties?.hidden === true,
          rowCount: numberValue(gridProperties?.rowCount),
        },
      ]
    })

    return {
      title: stringValue(spreadsheetProperties?.title) ?? "Untitled workbook",
      sheets,
    }
  }

  async getValues(
    userEmail: string,
    input: {
      readonly spreadsheetId: string
      readonly range: string
      readonly valueRenderOption?: SheetsValueRenderOption
    }
  ): Promise<ReadonlyArray<ReadonlyArray<unknown>>> {
    const token = await getAccessToken(this.serviceAccountKey, userEmail)
    const params = new URLSearchParams({
      valueRenderOption: input.valueRenderOption ?? "UNFORMATTED_VALUE",
    })
    const range = encodeURIComponent(input.range)
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${input.spreadsheetId}/values/${range}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Google Sheets API error (${response.status}): ${body.slice(0, 500)}`
      )
    }

    const payload: unknown = await response.json()
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("values" in payload) ||
      !Array.isArray(payload.values)
    ) {
      return []
    }
    return payload.values.filter(Array.isArray)
  }

  async appendValues(
    userEmail: string,
    input: {
      readonly spreadsheetId: string
      readonly range: string
      readonly values: ReadonlyArray<ReadonlyArray<unknown>>
    }
  ): Promise<GoogleSheetAppendResult> {
    const token = await getAccessToken(this.serviceAccountKey, userEmail)
    const params = new URLSearchParams({
      // Intake text is browser supplied. RAW prevents spreadsheet formula
      // execution while preserving the visible strings staff entered.
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
    })
    const range = encodeURIComponent(input.range)
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${input.spreadsheetId}/values/${range}:append?${params.toString()}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: input.values }),
      }
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Google Sheets API error (${response.status}): ${body.slice(0, 500)}`
      )
    }
    const payload = objectValue(await response.json())
    const updates = objectValue(payload?.updates)
    return { updatedRange: stringValue(updates?.updatedRange) }
  }

  async updateValues(
    userEmail: string,
    input: {
      readonly spreadsheetId: string
      readonly range: string
      readonly values: ReadonlyArray<ReadonlyArray<unknown>>
    }
  ): Promise<GoogleSheetAppendResult> {
    const token = await getAccessToken(this.serviceAccountKey, userEmail)
    const params = new URLSearchParams({ valueInputOption: "RAW" })
    const range = encodeURIComponent(input.range)
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${input.spreadsheetId}/values/${range}?${params.toString()}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: input.values }),
      }
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Google Sheets API error (${response.status}): ${body.slice(0, 500)}`
      )
    }
    const payload = objectValue(await response.json())
    const updates = objectValue(payload?.updates)
    return { updatedRange: stringValue(updates?.updatedRange) }
  }

  async batchUpdateValues(
    userEmail: string,
    input: {
      readonly spreadsheetId: string
      readonly updates: readonly GoogleSheetValueUpdate[]
    }
  ): Promise<void> {
    if (input.updates.length === 0) return
    const token = await getAccessToken(this.serviceAccountKey, userEmail)
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${input.spreadsheetId}/values:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: input.updates,
        }),
      }
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Google Sheets API error (${response.status}): ${body.slice(0, 500)}`
      )
    }
  }

  async addSheet(
    userEmail: string,
    input: {
      readonly spreadsheetId: string
      readonly title: string
      readonly rowCount: number
      readonly columnCount: number
    }
  ): Promise<GoogleSheetCreateResult> {
    const token = await getAccessToken(this.serviceAccountKey, userEmail)
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${input.spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: input.title,
                  gridProperties: {
                    rowCount: input.rowCount,
                    columnCount: input.columnCount,
                    frozenRowCount: 4,
                  },
                },
              },
            },
          ],
        }),
      }
    )
    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Google Sheets API error (${response.status}): ${body.slice(0, 500)}`
      )
    }
    const payload = objectValue(await response.json())
    const replies = Array.isArray(payload?.replies) ? payload.replies : []
    const reply = objectValue(replies[0])
    const addedSheet = objectValue(reply?.addSheet)
    const properties = objectValue(addedSheet?.properties)
    const sheetId = numberValue(properties?.sheetId)
    if (sheetId === null) {
      throw new Error("Google Sheets did not return the created worksheet ID.")
    }
    return { sheetId }
  }
}
