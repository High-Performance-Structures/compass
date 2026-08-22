const FOXIT_ESIGN_BASE_URL = "https://na1.fusion.foxit.com/esign/api/v1"

export type FoxitParty = {
  readonly name: string
  readonly email: string
  readonly sequence: number
}

export type FoxitEnvelopeField = {
  readonly type: "initial"
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly documentNumber: number
  readonly pageNumber: number
  readonly tabOrder: number
  readonly party: number
  readonly partyResponsible: number
  readonly name: string
  readonly tooltip: string
  readonly required: true
}

export type FoxitPreparedEnvelope = {
  readonly envelopeId: string
  readonly embeddedSessionUrl: string
}

function nameParts(name: string): { readonly firstName: string; readonly lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const firstName = parts.shift() ?? name.trim()
  return { firstName, lastName: parts.join(" ") || "Signer" }
}

function responseObject(value: unknown): object | null {
  return value && typeof value === "object" ? value : null
}

function responseString(value: object | null, key: string): string | null {
  if (!value) return null
  const item = Reflect.get(value, key)
  if (typeof item === "string" || typeof item === "number") return String(item)
  return null
}

export async function createFoxitPreparedEnvelope(input: {
  readonly clientId: string
  readonly clientSecret: string
  readonly folderName: string
  readonly pdfBase64: string
  readonly parties: readonly FoxitParty[]
  readonly fields: readonly FoxitEnvelopeField[]
  readonly successUrl: string
  readonly errorUrl: string
  readonly estimateId: string
  readonly sourceHash: string
}): Promise<FoxitPreparedEnvelope> {
  const response = await fetch(`${FOXIT_ESIGN_BASE_URL}/folders/createfolder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    body: JSON.stringify({
      folderName: input.folderName,
      inputType: "base64",
      fileNames: [`${input.folderName}.pdf`],
      base64FileString: [input.pdfBase64],
      processTextTags: false,
      processAcroFields: false,
      parties: input.parties.map((party) => {
        const parts = nameParts(party.name)
        return {
          firstName: parts.firstName,
          lastName: parts.lastName,
          emailId: party.email,
          permission: "FILL_FIELDS_AND_SIGN",
          sequence: party.sequence,
          allowNameChange: "false",
        }
      }),
      fields: input.fields,
      signInSequence: false,
      sendNow: false,
      createEmbeddedSigningSession: false,
      createEmbeddedSendingSession: true,
      fixDocuments: true,
      fixRecipientParties: true,
      hideAddGroupButton: true,
      hideAddMeButton: true,
      sendSuccessUrl: input.successUrl,
      sendErrorUrl: input.errorUrl,
      metadata: {
        compassEstimateId: input.estimateId,
        compassSourceHash: input.sourceHash,
      },
    }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = responseString(responseObject(body), "message")
    throw new Error(message ?? `Foxit preparation failed (${response.status}).`)
  }
  const object = responseObject(body)
  const folder = responseObject(object ? Reflect.get(object, "folder") : null)
  const envelopeId = responseString(folder, "folderId")
  const embeddedSessionUrl = responseString(object, "embeddedSessionURL")
  if (!envelopeId || !embeddedSessionUrl) {
    throw new Error("Foxit did not return an envelope preparation session.")
  }
  return { envelopeId, embeddedSessionUrl }
}

export async function downloadFoxitExecutedEnvelope(input: {
  readonly clientId: string
  readonly clientSecret: string
  readonly envelopeId: string
}): Promise<Response> {
  return fetch(
    `${FOXIT_ESIGN_BASE_URL}/folders/download?folderId=${encodeURIComponent(input.envelopeId)}`,
    {
      headers: {
        client_id: input.clientId,
        client_secret: input.clientSecret,
      },
    }
  )
}

export async function verifyFoxitWebhook(input: {
  readonly secret: string
  readonly body: Uint8Array
  readonly signature: string
}): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const body = new Uint8Array(input.body.byteLength)
  body.set(input.body)
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body))
  let encoded = ""
  for (let index = 0; index < digest.length; index += 1) {
    encoded += String.fromCharCode(digest[index] ?? 0)
  }
  const expected = btoa(encoded)
  if (expected.length !== input.signature.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ input.signature.charCodeAt(index)
  }
  return difference === 0
}
