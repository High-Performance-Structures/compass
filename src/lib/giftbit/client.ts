const REQUEST_TIMEOUT_MS = 15_000

export type GiftbitResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false
      readonly error: string
      readonly retrySafety: "safe" | "unknown"
    }

export type GiftbitDirectLink = {
  readonly campaignUuid: string
  readonly claimUrl: string
  readonly campaignStatus: string
}

export type GiftbitReward = {
  readonly uuid: string
  readonly campaignUuid: string
  readonly status: string
}

type Fetcher = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>

type GiftbitClientOptions = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly fetcher?: Fetcher
}

export type GiftbitClient = {
  readonly createDirectLink: (input: {
    readonly id: string
    readonly priceInCents: number
    readonly region: "USA"
    readonly expiresOn: string
  }) => Promise<GiftbitResult<GiftbitDirectLink>>
  readonly listRewards: (
    campaignUuid: string,
  ) => Promise<GiftbitResult<readonly GiftbitReward[]>>
  readonly cancelReward: (
    rewardUuid: string,
  ) => Promise<GiftbitResult<{ readonly cancelled: true }>>
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function httpsUrl(value: unknown): string | null {
  const candidate = nonEmptyString(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function providerError(payload: unknown, fallback: string): string {
  const error = objectValue(payload, "error")
  return (
    nonEmptyString(objectValue(error, "message")) ??
    nonEmptyString(objectValue(error, "name")) ??
    nonEmptyString(objectValue(payload, "message")) ??
    fallback
  )
}

function parseReward(value: unknown): GiftbitReward | null {
  const uuid = nonEmptyString(objectValue(value, "uuid"))
  const campaignUuid = nonEmptyString(objectValue(value, "campaign_uuid"))
  const status = nonEmptyString(objectValue(value, "status"))
  return uuid && campaignUuid && status ? { uuid, campaignUuid, status } : null
}

export function createGiftbitClient(options: GiftbitClientOptions): GiftbitClient {
  const fetcher = options.fetcher ?? fetch
  const baseUrl = options.baseUrl.replace(/\/$/, "")
  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  }

  async function createDirectLink(input: {
    readonly id: string
    readonly priceInCents: number
    readonly region: "USA"
    readonly expiresOn: string
  }): Promise<GiftbitResult<GiftbitDirectLink>> {
    let response: Response
    try {
      response = await fetcher(`${baseUrl}/direct_links`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          id: input.id,
          price_in_cents: input.priceInCents,
          region: input.region,
          link_count: 1,
          expiry: input.expiresOn,
        }),
      })
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Giftbit did not confirm the reward link.",
        // Giftbit guarantees the client-provided order id is idempotent.
        retrySafety: "safe",
      }
    }

    const payload = await readJson(response)
    if (response.status !== 200) {
      return {
        success: false,
        error: providerError(payload, "Giftbit rejected the reward order."),
        retrySafety: "safe",
      }
    }

    const directLinks = objectValue(payload, "direct_links")
    const claimUrl = Array.isArray(directLinks) ? httpsUrl(directLinks[0]) : null
    const campaign = objectValue(payload, "campaign")
    const campaignUuid = nonEmptyString(objectValue(campaign, "uuid"))
    const campaignStatus = nonEmptyString(objectValue(campaign, "status"))
    if (!claimUrl || !campaignUuid || !campaignStatus) {
      return {
        success: false,
        error: "Giftbit accepted the order without returning a reward link.",
        retrySafety: "safe",
      }
    }

    return {
      success: true,
      data: { campaignUuid, claimUrl, campaignStatus },
    }
  }

  async function listRewards(
    campaignUuid: string,
  ): Promise<GiftbitResult<readonly GiftbitReward[]>> {
    let response: Response
    try {
      const query = new URLSearchParams({ campaign_uuid: campaignUuid })
      response = await fetcher(`${baseUrl}/gifts?${query.toString()}`, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Giftbit reward status is unavailable.",
        retrySafety: "safe",
      }
    }

    const payload = await readJson(response)
    if (response.status !== 200) {
      return {
        success: false,
        error: providerError(payload, "Giftbit reward status is unavailable."),
        retrySafety: "safe",
      }
    }
    const gifts = objectValue(payload, "gifts")
    return {
      success: true,
      data: Array.isArray(gifts)
        ? gifts.flatMap((value) => {
            const reward = parseReward(value)
            return reward ? [reward] : []
          })
        : [],
    }
  }

  async function cancelReward(
    rewardUuid: string,
  ): Promise<GiftbitResult<{ readonly cancelled: true }>> {
    let response: Response
    try {
      response = await fetcher(
        `${baseUrl}/gifts/${encodeURIComponent(rewardUuid)}`,
        {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Giftbit did not confirm reward cancellation.",
        retrySafety: "unknown",
      }
    }

    const payload = await readJson(response)
    if (response.status !== 200) {
      return {
        success: false,
        error: providerError(payload, "Giftbit could not cancel the reward."),
        retrySafety: response.status < 500 ? "safe" : "unknown",
      }
    }
    return { success: true, data: { cancelled: true } }
  }

  return { createDirectLink, listRewards, cancelReward }
}
