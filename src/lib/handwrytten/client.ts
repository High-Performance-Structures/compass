const HANDWRYTTEN_API_URL = "https://api.handwrytten.com/v2"
const MAX_CARD_PAGES = 20
const REQUEST_TIMEOUT_MS = 15_000

export type HandwryttenCard = {
  readonly id: number
  readonly name: string
  readonly description: string
  readonly coverUrl: string | null
  readonly price: number | null
  readonly categoryName: string
  readonly characters: number | null
}

export type HandwryttenAddress = {
  readonly firstName: string
  readonly lastName: string
  readonly businessName: string
  readonly address1: string
  readonly address2: string
  readonly city: string
  readonly state: string
  readonly postalCode: string
  readonly country: "United States"
}

export type SubmitHandwryttenOrderInput = {
  readonly cardId: number
  readonly message: string
  readonly wishes: string
  readonly fontLabel: string
  readonly sender: HandwryttenAddress
  readonly recipient: HandwryttenAddress
  readonly clientMetadata: string
}

export type HandwryttenResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false
      readonly error: string
      readonly retrySafety: "safe" | "unknown"
    }

export type HandwryttenOrder = {
  readonly orderId: number
  readonly mailSent: boolean
}

type Fetcher = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>

type HandwryttenClientOptions = {
  readonly apiKey: string
  readonly fetcher?: Fetcher
  readonly baseUrl?: string
}

export type HandwryttenClient = {
  readonly listCards: () => Promise<HandwryttenResult<readonly HandwryttenCard[]>>
  readonly submitOrder: (
    input: SubmitHandwryttenOrderInput,
  ) => Promise<HandwryttenResult<HandwryttenOrder>>
  readonly cancelOrder: (
    orderId: number,
  ) => Promise<HandwryttenResult<{ readonly cancelled: true }>>
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
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

function providerError(payload: unknown, fallback: string): string {
  return (
    nonEmptyString(objectValue(payload, "error")) ??
    nonEmptyString(objectValue(payload, "message")) ??
    fallback
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function parseCard(value: unknown): HandwryttenCard | null {
  const id = finiteNumber(objectValue(value, "id"))
  const name = nonEmptyString(objectValue(value, "name"))
  if (id === null || !Number.isInteger(id) || id <= 0 || !name) return null

  return {
    id,
    name,
    description: nonEmptyString(objectValue(value, "description")) ?? "",
    coverUrl: httpsUrl(objectValue(value, "cover")),
    price: finiteNumber(objectValue(value, "price")),
    categoryName:
      nonEmptyString(objectValue(value, "category_name")) ?? "Other",
    characters: finiteNumber(objectValue(value, "characters")),
  }
}

function parseCards(payload: unknown): readonly HandwryttenCard[] {
  const rawCards = objectValue(payload, "cards")
  if (!Array.isArray(rawCards)) return []
  return rawCards.flatMap((value) => {
    const card = parseCard(value)
    return card ? [card] : []
  })
}

function isLastPage(payload: unknown): boolean {
  const pagination = objectValue(payload, "pagination")
  return objectValue(pagination, "is_last") !== false
}

function requestFailure(
  error: unknown,
  fallback: string,
): HandwryttenResult<never> {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
    retrySafety: "unknown",
  }
}

export function createHandwryttenClient(
  options: HandwryttenClientOptions,
): HandwryttenClient {
  const fetcher = options.fetcher ?? fetch
  const baseUrl = (options.baseUrl ?? HANDWRYTTEN_API_URL).replace(/\/$/, "")
  const headers = {
    Accept: "application/json",
    Authorization: options.apiKey,
    "Content-Type": "application/json",
  }

  async function listCards(): Promise<
    HandwryttenResult<readonly HandwryttenCard[]>
  > {
    const cards: HandwryttenCard[] = []

    for (let page = 0; page < MAX_CARD_PAGES; page += 1) {
      let response: Response
      try {
        response = await fetcher(
          `${baseUrl}/cards/list?with_images=true&with_detailed_images=false&lowres=true&page=${page}`,
          {
            headers,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        )
      } catch (error) {
        return requestFailure(error, "Unable to load Handwrytten cards.")
      }

      const payload = await readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: providerError(payload, "Unable to load Handwrytten cards."),
          retrySafety: response.status < 500 ? "safe" : "unknown",
        }
      }

      cards.push(...parseCards(payload))
      if (isLastPage(payload)) {
        return { success: true, data: cards }
      }
    }

    return {
      success: false,
      error: "Handwrytten returned more card pages than Compass can safely load.",
      retrySafety: "safe",
    }
  }

  async function submitOrder(
    input: SubmitHandwryttenOrderInput,
  ): Promise<HandwryttenResult<HandwryttenOrder>> {
    let response: Response
    try {
      response = await fetcher(`${baseUrl}/orders/singleStepOrder`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          card_id: input.cardId,
          message: input.message,
          wishes: input.wishes,
          font_label: input.fontLabel,
          validate_address: true,
          delivery_confirmation: 0,
          sender_first_name: input.sender.firstName,
          sender_last_name: input.sender.lastName,
          sender_business_name: input.sender.businessName,
          sender_address1: input.sender.address1,
          sender_address2: input.sender.address2,
          sender_city: input.sender.city,
          sender_zip: input.sender.postalCode,
          sender_state: input.sender.state,
          sender_country_id: 1,
          sender_country: input.sender.country,
          recipient_first_name: input.recipient.firstName,
          recipient_last_name: input.recipient.lastName,
          recipient_business_name: input.recipient.businessName,
          recipient_address1: input.recipient.address1,
          recipient_address2: input.recipient.address2,
          recipient_city: input.recipient.city,
          recipient_zip: input.recipient.postalCode,
          recipient_state: input.recipient.state,
          recipient_country_id: 1,
          recipient_country: input.recipient.country,
          client_metadata: input.clientMetadata,
        }),
      })
    } catch (error) {
      return requestFailure(error, "Handwrytten did not confirm the card order.")
    }

    const payload = await readJson(response)
    if (!response.ok) {
      return {
        success: false,
        error: providerError(payload, "Handwrytten rejected the card order."),
        retrySafety: response.status < 500 ? "safe" : "unknown",
      }
    }

    const orderId = finiteNumber(objectValue(payload, "order_id"))
    if (orderId === null || !Number.isInteger(orderId) || orderId <= 0) {
      return {
        success: false,
        error: "Handwrytten accepted the request without returning an order ID.",
        retrySafety: "unknown",
      }
    }

    return {
      success: true,
      data: {
        orderId,
        mailSent: objectValue(payload, "mail_sent") === 1,
      },
    }
  }

  async function cancelOrder(
    orderId: number,
  ): Promise<HandwryttenResult<{ readonly cancelled: true }>> {
    let response: Response
    try {
      response = await fetcher(`${baseUrl}/orders/cancel`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({ order_id: orderId }),
      })
    } catch (error) {
      return requestFailure(error, "Handwrytten did not confirm cancellation.")
    }

    const payload = await readJson(response)
    if (!response.ok) {
      return {
        success: false,
        error: providerError(payload, "Handwrytten could not cancel the card."),
        retrySafety: response.status < 500 ? "safe" : "unknown",
      }
    }

    return { success: true, data: { cancelled: true } }
  }

  return { listCards, submitOrder, cancelOrder }
}
