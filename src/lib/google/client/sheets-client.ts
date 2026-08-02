import { getAccessToken } from "@/lib/google/auth/service-account"
import {
  GOOGLE_SHEETS_API,
  type ServiceAccountKey,
} from "@/lib/google/config"

type SheetsValueRenderOption =
  | "FORMATTED_VALUE"
  | "UNFORMATTED_VALUE"
  | "FORMULA"

export class SheetsClient {
  constructor(
    private readonly serviceAccountKey: ServiceAccountKey
  ) {}

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
