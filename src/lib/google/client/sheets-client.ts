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
}
