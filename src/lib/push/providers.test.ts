import {
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
} from "jose"
import { beforeAll, describe, expect, it, vi } from "vitest"
import {
  getApnsAuthorizationToken,
  getFirebaseAccessToken,
  parseFirebaseCredentials,
  sendApnsMessage,
  sendFcmMessage,
  type ApnsCredentials,
  type FirebaseCredentials,
} from "./providers"

let firebasePrivateKey = ""
let firebasePublicKey: CryptoKey
let apnsPrivateKey = ""
let apnsPublicKey: CryptoKey

beforeAll(async () => {
  const firebaseKeys = await generateKeyPair("RS256", {
    extractable: true,
  })
  firebasePrivateKey = await exportPKCS8(firebaseKeys.privateKey)
  firebasePublicKey = firebaseKeys.publicKey

  const apnsKeys = await generateKeyPair("ES256", {
    extractable: true,
  })
  apnsPrivateKey = await exportPKCS8(apnsKeys.privateKey)
  apnsPublicKey = apnsKeys.publicKey
})

function firebaseCredentials(): FirebaseCredentials {
  return {
    projectId: "compass-mobile-test",
    clientEmail: "push@compass-mobile-test.iam.gserviceaccount.com",
    privateKey: firebasePrivateKey,
  }
}

function apnsCredentials(): ApnsCredentials {
  return {
    keyId: "ABC123DEFG",
    teamId: "78SM7S793Z",
    privateKey: apnsPrivateKey,
    bundleId: "com.hpscolorado.compass",
    environment: "production",
  }
}

describe("push providers", () => {
  it("parses Firebase service-account credentials", () => {
    const parsed = parseFirebaseCredentials(
      JSON.stringify({
        project_id: "compass-mobile-test",
        client_email:
          "push@compass-mobile-test.iam.gserviceaccount.com",
        private_key: firebasePrivateKey,
      }),
    )

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.credentials.projectId).toBe("compass-mobile-test")
    }
  })

  it("creates a signed Firebase OAuth assertion", async () => {
    let assertion = ""
    const fetcher: typeof fetch = vi.fn(
      async (_input, init) => {
        const params = new URLSearchParams(String(init?.body ?? ""))
        assertion = params.get("assertion") ?? ""
        return Response.json({ access_token: "firebase-access-token" })
      },
    )

    const result = await getFirebaseAccessToken(
      firebaseCredentials(),
      fetcher,
    )

    expect(result).toEqual({
      success: true,
      accessToken: "firebase-access-token",
    })
    const verified = await jwtVerify(assertion, firebasePublicKey, {
      audience: "https://oauth2.googleapis.com/token",
      issuer: "push@compass-mobile-test.iam.gserviceaccount.com",
    })
    expect(verified.payload.scope).toBe(
      "https://www.googleapis.com/auth/firebase.messaging",
    )
  })

  it("sends Android notifications through the project-scoped FCM endpoint", async () => {
    let requestUrl = ""
    let authorization = ""
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get("Authorization") ?? ""
      return Response.json({ name: "projects/test/messages/1" })
    })

    const result = await sendFcmMessage(
      firebaseCredentials(),
      "firebase-access-token",
      "android-device-token",
      { title: "Hello", body: "Job updated" },
      fetcher,
    )

    expect(result).toEqual({ status: "sent" })
    expect(requestUrl).toBe(
      "https://fcm.googleapis.com/v1/projects/compass-mobile-test/messages:send",
    )
    expect(authorization).toBe("Bearer firebase-access-token")
  })

  it("marks unregistered FCM tokens as invalid", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        Response.json(
          {
            error: {
              details: [{ errorCode: "UNREGISTERED" }],
            },
          },
          { status: 404 },
        ),
    )

    const result = await sendFcmMessage(
      firebaseCredentials(),
      "firebase-access-token",
      "expired-token",
      { title: "Hello", body: "Job updated" },
      fetcher,
    )

    expect(result).toEqual({ status: "invalid-token" })
  })

  it("does not delete a token for an unrelated FCM 404", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        Response.json(
          { error: { status: "NOT_FOUND" } },
          { status: 404 },
        ),
    )

    const result = await sendFcmMessage(
      firebaseCredentials(),
      "firebase-access-token",
      "valid-token",
      { title: "Hello", body: "Job updated" },
      fetcher,
    )

    expect(result).toEqual({
      status: "failed",
      providerStatus: 404,
      reason: "FCM rejected the notification",
    })
  })

  it("creates an APNs provider token and targets the production API", async () => {
    const credentials = apnsCredentials()
    const authorization = await getApnsAuthorizationToken(credentials)
    expect(authorization.success).toBe(true)
    if (!authorization.success) {
      return
    }

    const verified = await jwtVerify(
      authorization.authorizationToken,
      apnsPublicKey,
      { issuer: credentials.teamId },
    )
    expect(verified.protectedHeader.kid).toBe(credentials.keyId)

    let requestUrl = ""
    let requestHeaders = new Headers()
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      return new Response(null, { status: 200 })
    })
    const result = await sendApnsMessage(
      credentials,
      authorization.authorizationToken,
      "ios-device-token",
      { title: "Hello", body: "Job updated" },
      fetcher,
    )

    expect(result).toEqual({ status: "sent" })
    expect(requestUrl).toBe(
      "https://api.push.apple.com/3/device/ios-device-token",
    )
    expect(requestHeaders.get("apns-topic")).toBe(
      "com.hpscolorado.compass",
    )
    expect(requestHeaders.get("apns-push-type")).toBe("alert")
  })
})
