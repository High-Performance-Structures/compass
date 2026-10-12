#!/usr/bin/env node
// Uploads a signed Android App Bundle to a Google Play testing or production
// track through the Play Developer API.
//
// Credentials come from GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: a Google Cloud
// service-account key (raw JSON or base64 of the JSON) that has release access
// to the app in Play Console. Run it through a secret manager so the key never
// lands on disk, for example:
//
//   signet secret exec --secret GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=GOOGLE_PLAY_SERVICE_ACCOUNT_JSON \
//     bun scripts/upload-play-release.mjs --track internal
//
// Options:
//   --aab <path>        default android/app/build/outputs/bundle/release/app-release.aab
//   --track <name>      internal (default), alpha, beta, or production
//   --status <status>   completed (default) or draft; draft is required while
//                       the app itself is still a draft in Play Console
//   --notes <text>      release notes (en-US)
//   --dry-run           validate credentials and the bundle, then discard the edit

import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { importPKCS8, SignJWT } from "jose"

const PACKAGE_NAME = "com.hpscolorado.compass"
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3"
const UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3"

const { values } = parseArgs({
  options: {
    aab: { type: "string", default: "android/app/build/outputs/bundle/release/app-release.aab" },
    track: { type: "string", default: "internal" },
    status: { type: "string", default: "completed" },
    notes: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
})

function readServiceAccount() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not set.")
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")
  const account = JSON.parse(json)
  if (!account.client_email || !account.private_key) {
    throw new Error("The service-account key is missing client_email or private_key.")
  }
  return account
}

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000)
  const key = await importPKCS8(account.private_key, "RS256")
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/androidpublisher" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`Google token request failed: ${JSON.stringify(body)}`)
  return body.access_token
}

async function play(token, method, url, init = {}) {
  const response = await fetch(url, {
    method,
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) {
    throw new Error(`${method} ${url.replace(API, "").replace(UPLOAD_API, "")} failed (${response.status}): ${body.error?.message ?? text}`)
  }
  return body
}

async function main() {
  const account = readServiceAccount()
  const token = await accessToken(account)
  const bundle = await readFile(values.aab)
  console.log(`Authenticated as ${account.client_email}`)

  const edit = await play(token, "POST", `${API}/applications/${PACKAGE_NAME}/edits`)
  const editUrl = `${API}/applications/${PACKAGE_NAME}/edits/${edit.id}`
  try {
    const uploaded = await play(
      token,
      "POST",
      `${UPLOAD_API}/applications/${PACKAGE_NAME}/edits/${edit.id}/bundles?uploadType=media`,
      { headers: { "Content-Type": "application/octet-stream" }, body: bundle }
    )
    console.log(`Uploaded bundle versionCode ${uploaded.versionCode} (${bundle.length} bytes)`)

    await play(token, "PUT", `${editUrl}/tracks/${values.track}`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track: values.track,
        releases: [{
          versionCodes: [String(uploaded.versionCode)],
          status: values.status,
          ...(values.notes
            ? { releaseNotes: [{ language: "en-US", text: values.notes }] }
            : {}),
        }],
      }),
    })

    if (values["dry-run"]) {
      await play(token, "POST", `${editUrl}:validate`)
      await play(token, "DELETE", editUrl)
      console.log("Dry run validated; edit discarded.")
      return
    }

    await play(token, "POST", `${editUrl}:commit`)
    console.log(`Released versionCode ${uploaded.versionCode} to the ${values.track} track (${values.status}).`)
  } catch (error) {
    await play(token, "DELETE", editUrl).catch(() => undefined)
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
