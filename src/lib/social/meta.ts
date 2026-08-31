import "server-only"

const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
] as const

type JsonRecord = Readonly<Record<string, unknown>>

export type MetaPageCandidate = {
  readonly pageId: string
  readonly pageName: string
  readonly pageAccessToken: string
  readonly instagramAccountId: string | null
  readonly instagramUsername: string | null
}

export type MetaAlbumCandidate = {
  readonly id: string
  readonly name: string
}

function metaPageCandidate(value: unknown): MetaPageCandidate | null {
  if (!isRecord(value)) return null
  const pageId = stringValue(value.id)
  const pageName = stringValue(value.name)
  const pageAccessToken = stringValue(value.access_token)
  if (!pageId || !pageName || !pageAccessToken) return null
  const instagram = isRecord(value.instagram_business_account)
    ? value.instagram_business_account
    : null
  return {
    pageId,
    pageName,
    pageAccessToken,
    instagramAccountId: instagram ? stringValue(instagram.id) : null,
    instagramUsername: instagram ? stringValue(instagram.username) : null,
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function isMetaPageScope(value: string): boolean {
  return value === "pages_show_list"
    || value === "pages_read_engagement"
    || value === "pages_manage_posts"
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function graphError(operation: string, response: Response, payload: unknown): Error {
  const message = isRecord(payload) && isRecord(payload.error)
    ? stringValue(payload.error.message)
    : null
  return new Error(`${operation} failed (${response.status})${message ? `: ${message}` : "."}`)
}

export function buildMetaAuthorizationUrl(input: {
  readonly apiVersion: string
  readonly appId: string
  readonly redirectUri: string
  readonly state: string
}): string {
  const url = new URL(`https://www.facebook.com/${input.apiVersion}/dialog/oauth`)
  url.searchParams.set("client_id", input.appId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("state", input.state)
  url.searchParams.set("scope", META_SCOPES.join(","))
  url.searchParams.set("response_type", "code")
  return url.toString()
}

export async function exchangeMetaAuthorizationCode(input: {
  readonly apiVersion: string
  readonly appId: string
  readonly appSecret: string
  readonly redirectUri: string
  readonly code: string
}): Promise<string> {
  const tokenUrl = new URL(`https://graph.facebook.com/${input.apiVersion}/oauth/access_token`)
  tokenUrl.searchParams.set("client_id", input.appId)
  tokenUrl.searchParams.set("client_secret", input.appSecret)
  tokenUrl.searchParams.set("redirect_uri", input.redirectUri)
  tokenUrl.searchParams.set("code", input.code)
  const response = await fetch(tokenUrl)
  const payload = await responsePayload(response)
  if (!response.ok || !isRecord(payload)) throw graphError("Meta authorization", response, payload)
  const accessToken = stringValue(payload.access_token)
  if (!accessToken) throw new Error("Meta did not return an access token.")

  const longLivedUrl = new URL(`https://graph.facebook.com/${input.apiVersion}/oauth/access_token`)
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token")
  longLivedUrl.searchParams.set("client_id", input.appId)
  longLivedUrl.searchParams.set("client_secret", input.appSecret)
  longLivedUrl.searchParams.set("fb_exchange_token", accessToken)
  const longLivedResponse = await fetch(longLivedUrl)
  const longLivedPayload = await responsePayload(longLivedResponse)
  if (!longLivedResponse.ok || !isRecord(longLivedPayload)) {
    throw graphError("Meta long-lived authorization", longLivedResponse, longLivedPayload)
  }
  return stringValue(longLivedPayload.access_token) ?? accessToken
}

export async function getManagedMetaPages(input: {
  readonly apiVersion: string
  readonly appId: string
  readonly appSecret: string
  readonly userAccessToken: string
}): Promise<readonly MetaPageCandidate[]> {
  const url = new URL(`https://graph.facebook.com/${input.apiVersion}/me/accounts`)
  url.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account{id,username}",
  )
  url.searchParams.set("limit", "100")
  url.searchParams.set("access_token", input.userAccessToken)
  const response = await fetch(url)
  const payload = await responsePayload(response)
  if (!response.ok || !isRecord(payload) || !Array.isArray(payload.data)) {
    throw graphError("Meta Page lookup", response, payload)
  }

  const candidates: MetaPageCandidate[] = []
  for (const item of payload.data) {
    const candidate = metaPageCandidate(item)
    if (candidate) candidates.push(candidate)
  }
  if (candidates.length > 0) return candidates

  // Meta's granular asset picker can authorize Pages without returning them from
  // /me/accounts. Recover only the Page targets attached to the granted Page scopes.
  const debugUrl = new URL(`https://graph.facebook.com/${input.apiVersion}/debug_token`)
  debugUrl.searchParams.set("input_token", input.userAccessToken)
  const debugResponse = await fetch(debugUrl, {
    headers: { Authorization: `Bearer ${input.appId}|${input.appSecret}` },
  })
  const debugPayload = await responsePayload(debugResponse)
  if (!debugResponse.ok || !isRecord(debugPayload) || !isRecord(debugPayload.data)) {
    throw graphError("Meta token inspection", debugResponse, debugPayload)
  }

  const pageIds = new Set<string>()
  const granularScopes = Array.isArray(debugPayload.data.granular_scopes)
    ? debugPayload.data.granular_scopes
    : []
  for (const granularScope of granularScopes) {
    if (!isRecord(granularScope)) continue
    const scope = stringValue(granularScope.scope)
    if (!scope || !isMetaPageScope(scope) || !Array.isArray(granularScope.target_ids)) {
      continue
    }
    for (const targetId of granularScope.target_ids) {
      const pageId = stringValue(targetId)
      if (pageId) pageIds.add(pageId)
    }
  }

  for (const pageId of pageIds) {
    const pageUrl = new URL(`https://graph.facebook.com/${input.apiVersion}/${pageId}`)
    pageUrl.searchParams.set(
      "fields",
      "id,name,access_token,instagram_business_account{id,username}",
    )
    pageUrl.searchParams.set("access_token", input.userAccessToken)
    const pageResponse = await fetch(pageUrl)
    const pagePayload = await responsePayload(pageResponse)
    if (!pageResponse.ok || !isRecord(pagePayload)) {
      throw graphError("Meta Page lookup", pageResponse, pagePayload)
    }
    const candidate = metaPageCandidate(pagePayload)
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

async function graphFormPost(input: {
  readonly apiVersion: string
  readonly path: string
  readonly accessToken: string
  readonly fields: Readonly<Record<string, string>>
}): Promise<JsonRecord> {
  const response = await fetch(
    `https://graph.facebook.com/${input.apiVersion}/${input.path.replace(/^\//, "")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...input.fields,
        access_token: input.accessToken,
      }),
    },
  )
  const payload = await responsePayload(response)
  if (!response.ok || !isRecord(payload)) {
    throw graphError("Meta publishing", response, payload)
  }
  return payload
}

async function graphGet(input: {
  readonly apiVersion: string
  readonly path: string
  readonly accessToken: string
  readonly fields: string
}): Promise<JsonRecord> {
  const url = new URL(
    `https://graph.facebook.com/${input.apiVersion}/${input.path.replace(/^\//, "")}`,
  )
  url.searchParams.set("fields", input.fields)
  url.searchParams.set("access_token", input.accessToken)
  const response = await fetch(url)
  const payload = await responsePayload(response)
  if (!response.ok || !isRecord(payload)) {
    throw graphError("Meta lookup", response, payload)
  }
  return payload
}

function normalizedAlbumName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
}

export async function findFacebookAlbumByName(input: {
  readonly apiVersion: string
  readonly pageId: string
  readonly accessToken: string
  readonly name: string
}): Promise<MetaAlbumCandidate | null> {
  const wantedName = normalizedAlbumName(input.name)
  let nextUrl: URL | null = new URL(
    `https://graph.facebook.com/${input.apiVersion}/${input.pageId}/albums`,
  )
  nextUrl.searchParams.set("fields", "id,name")
  nextUrl.searchParams.set("limit", "100")
  nextUrl.searchParams.set("access_token", input.accessToken)

  // Keep discovery bounded so a Page with an unexpectedly large album catalog
  // cannot hold a publishing request open indefinitely.
  for (let page = 0; page < 10 && nextUrl; page += 1) {
    const response = await fetch(nextUrl)
    const payload = await responsePayload(response)
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.data)) {
      throw graphError("Facebook album lookup", response, payload)
    }
    for (const item of payload.data) {
      if (!isRecord(item)) continue
      const id = stringValue(item.id)
      const name = stringValue(item.name)
      if (id && name && normalizedAlbumName(name) === wantedName) {
        return { id, name }
      }
    }

    const paging = isRecord(payload.paging) ? payload.paging : null
    const next = paging ? stringValue(paging.next) : null
    if (!next) return null
    const candidate = new URL(next)
    if (candidate.protocol !== "https:" || candidate.hostname !== "graph.facebook.com") {
      throw new Error("Facebook returned an invalid album paging URL.")
    }
    nextUrl = candidate
  }

  if (nextUrl) {
    throw new Error("Facebook has too many albums to safely identify this project album.")
  }
  return null
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForInstagramContainer(input: {
  readonly apiVersion: string
  readonly containerId: string
  readonly accessToken: string
}): Promise<void> {
  // Image containers normally finish immediately, but Meta fetches the signed
  // Compass URL asynchronously. Keep the wait bounded for the Worker request.
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const payload = await graphGet({
      apiVersion: input.apiVersion,
      path: input.containerId,
      accessToken: input.accessToken,
      fields: "status_code",
    })
    const status = stringValue(payload.status_code)
    if (status === "FINISHED" || status === "PUBLISHED") return
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Instagram media processing ended with status ${status}.`)
    }
    if (attempt < 8) await wait(2_000)
  }
  throw new Error("Instagram is still processing the photos. Retry publishing shortly.")
}

export async function createFacebookProjectAlbum(input: {
  readonly apiVersion: string
  readonly pageId: string
  readonly accessToken: string
  readonly name: string
  readonly description: string
}): Promise<string> {
  const payload = await graphFormPost({
    apiVersion: input.apiVersion,
    path: `${input.pageId}/albums`,
    accessToken: input.accessToken,
    fields: { name: input.name, message: input.description },
  })
  const id = stringValue(payload.id)
  if (!id) throw new Error("Facebook did not return the new album ID.")
  return id
}

export async function publishFacebookPhotos(input: {
  readonly apiVersion: string
  readonly pageId: string
  readonly accessToken: string
  readonly text: string
  readonly photoUrls: readonly string[]
  readonly albumId: string | null
}): Promise<{ readonly id: string; readonly url: string }> {
  if (input.photoUrls.length === 0) {
    const payload = await graphFormPost({
      apiVersion: input.apiVersion,
      path: `${input.pageId}/feed`,
      accessToken: input.accessToken,
      fields: { message: input.text },
    })
    const id = stringValue(payload.id)
    if (!id) throw new Error("Facebook did not return the post ID.")
    return { id, url: `https://www.facebook.com/${id.replace("_", "/posts/")}` }
  }

  if (!input.albumId && input.photoUrls.length === 1) {
    const payload = await graphFormPost({
      apiVersion: input.apiVersion,
      path: `${input.pageId}/photos`,
      accessToken: input.accessToken,
      fields: { url: input.photoUrls[0] ?? "", message: input.text },
    })
    const id = stringValue(payload.post_id) ?? stringValue(payload.id)
    if (!id) throw new Error("Facebook did not return the photo post ID.")
    return { id, url: `https://www.facebook.com/${input.pageId}/posts/${id}` }
  }

  const mediaIds: string[] = []
  for (const photoUrl of input.photoUrls) {
    const payload = await graphFormPost({
      apiVersion: input.apiVersion,
      path: `${input.albumId ?? input.pageId}/photos`,
      accessToken: input.accessToken,
      fields: { url: photoUrl, published: "false" },
    })
    const id = stringValue(payload.id)
    if (!id) throw new Error("Facebook did not return an uploaded photo ID.")
    mediaIds.push(id)
  }
  const payload = await graphFormPost({
    apiVersion: input.apiVersion,
    path: `${input.pageId}/feed`,
    accessToken: input.accessToken,
    fields: {
      message: input.text,
      attached_media: JSON.stringify(mediaIds.map((media_fbid) => ({ media_fbid }))),
    },
  })
  const id = stringValue(payload.id)
  if (!id) throw new Error("Facebook did not return the post ID.")
  return { id, url: `https://www.facebook.com/${input.pageId}/posts/${id}` }
}

export async function publishInstagramPhotos(input: {
  readonly apiVersion: string
  readonly instagramAccountId: string
  readonly accessToken: string
  readonly caption: string
  readonly photoUrls: readonly string[]
}): Promise<{ readonly id: string; readonly url: string | null }> {
  if (input.photoUrls.length === 0) throw new Error("Instagram requires at least one photo.")
  if (input.photoUrls.length > 10) throw new Error("Instagram supports up to 10 carousel items.")

  let creationId: string
  if (input.photoUrls.length === 1) {
    const container = await graphFormPost({
      apiVersion: input.apiVersion,
      path: `${input.instagramAccountId}/media`,
      accessToken: input.accessToken,
      fields: { image_url: input.photoUrls[0] ?? "", caption: input.caption },
    })
    const id = stringValue(container.id)
    if (!id) throw new Error("Instagram did not return a media container ID.")
    creationId = id
  } else {
    const childIds: string[] = []
    for (const photoUrl of input.photoUrls) {
      const child = await graphFormPost({
        apiVersion: input.apiVersion,
        path: `${input.instagramAccountId}/media`,
        accessToken: input.accessToken,
        fields: { image_url: photoUrl, is_carousel_item: "true" },
      })
      const id = stringValue(child.id)
      if (!id) throw new Error("Instagram did not return a carousel item ID.")
      childIds.push(id)
    }
    await Promise.all(childIds.map((containerId) => waitForInstagramContainer({
      apiVersion: input.apiVersion,
      containerId,
      accessToken: input.accessToken,
    })))
    const carousel = await graphFormPost({
      apiVersion: input.apiVersion,
      path: `${input.instagramAccountId}/media`,
      accessToken: input.accessToken,
      fields: {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption: input.caption,
      },
    })
    const id = stringValue(carousel.id)
    if (!id) throw new Error("Instagram did not return a carousel container ID.")
    creationId = id
  }

  await waitForInstagramContainer({
    apiVersion: input.apiVersion,
    containerId: creationId,
    accessToken: input.accessToken,
  })

  const published = await graphFormPost({
    apiVersion: input.apiVersion,
    path: `${input.instagramAccountId}/media_publish`,
    accessToken: input.accessToken,
    fields: { creation_id: creationId },
  })
  const id = stringValue(published.id)
  if (!id) throw new Error("Instagram did not return the published media ID.")
  // A media object ID is not the shortcode used by instagram.com/p URLs.
  // If the follow-up lookup fails, retain the successful publish with no link
  // so a retry cannot create a duplicate external post.
  let permalink: string | null = null
  try {
    const media = await graphGet({
      apiVersion: input.apiVersion,
      path: id,
      accessToken: input.accessToken,
      fields: "permalink",
    })
    permalink = stringValue(media.permalink)
  } catch (error) {
    console.error("Instagram permalink lookup failed after publishing", error)
  }
  return { id, url: permalink }
}

export function requiredMetaScopes(): readonly string[] {
  return META_SCOPES
}
