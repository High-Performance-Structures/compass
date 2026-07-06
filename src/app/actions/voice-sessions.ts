"use server"

import { and, eq, gt, inArray, sql } from "drizzle-orm"
import type {
  CachedUserDetails,
  UserDetailsResponseV2,
} from "@cloudflare/realtimekit"
import { getDb } from "@/db"
import { projectMembers, users } from "@/db/schema"
import {
  channelMembers,
  channels,
  voiceRealtimeKitMeetings,
  voiceParticipants,
  voiceSignals,
} from "@/db/schema-conversations"
import { getCloudflareContext } from "@/lib/db"
import { getCurrentUser, type AuthUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"

const ACTIVE_PARTICIPANT_WINDOW_MS = 30_000
const STALE_SIGNAL_WINDOW_MS = 5 * 60_000
const REALTIMEKIT_MEETING_CACHE_WINDOW_MS = 2 * 60 * 60_000
const REALTIMEKIT_RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504])

type VoiceSignalType = "offer" | "answer" | "ice"

export type VoiceParticipantData = {
  readonly userId: string
  readonly displayName: string | null
  readonly isMuted: boolean
  readonly isDeafened: boolean
  readonly joinedAt: string
  readonly lastSeenAt: string
}

export type VoiceSignalData = {
  readonly id: string
  readonly senderUserId: string
  readonly signalType: VoiceSignalType
  readonly payloadJson: string
  readonly createdAt: string
}

type VoiceChannelAccess = {
  readonly id: string
  readonly name: string
  readonly organizationId: string
  readonly projectId: string | null
  readonly isPrivate: boolean
  readonly audience: string
}

type VoiceActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

type RealtimeKitConfig = {
  readonly accountId: string
  readonly appId: string
  readonly apiToken: string
}

type RealtimeKitMeeting = {
  readonly id: string
  readonly title: string
}

export type RealtimeKitJoinData = {
  readonly authToken: string
  readonly cachedUserDetails: CachedUserDetails
  readonly meetingId: string
  readonly meetingTitle: string
  readonly participantName: string
}

type RealtimeKitParticipantToken = {
  readonly authToken: string
  readonly cachedUserDetails: CachedUserDetails
}

type RealtimeKitIceServer = CachedUserDetails["iceServers"][number]

type RealtimeKitJoinOptions = {
  readonly resetMeeting?: boolean
}

function activeAfterIso(now = Date.now()): string {
  return new Date(now - ACTIVE_PARTICIPANT_WINDOW_MS).toISOString()
}

function staleSignalBeforeIso(now = Date.now()): string {
  return new Date(now - STALE_SIGNAL_WINDOW_MS).toISOString()
}

function staleRealtimeKitMeetingBeforeIso(now = Date.now()): string {
  return new Date(now - REALTIMEKIT_MEETING_CACHE_WINDOW_MS).toISOString()
}

function normalizeSignalType(value: string): VoiceSignalType | null {
  if (value === "offer" || value === "answer" || value === "ice") {
    return value
  }
  return null
}

function displayNameForUser(user: Pick<AuthUser, "displayName" | "email">): string {
  return user.displayName ?? user.email.split("@")[0] ?? "Compass user"
}

function readEnvString(env: CloudflareEnv, key: string): string | null {
  const value: unknown = Reflect.get(env, key)
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function realtimeKitConfigFromEnv(env: CloudflareEnv): RealtimeKitConfig | null {
  const accountId = readEnvString(env, "CLOUDFLARE_ACCOUNT_ID")
  const appId = readEnvString(env, "REALTIMEKIT_APP_ID")
  const apiToken = readEnvString(env, "CLOUDFLARE_API_TOKEN")
  if (!accountId || !appId || !apiToken) return null
  return { accountId, appId, apiToken }
}

function recordValue(
  record: Readonly<Record<string, unknown>>,
  key: string
): unknown {
  return record[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function extractApiError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback
  const topLevelMessage = recordValue(payload, "message")
  if (typeof topLevelMessage === "string" && topLevelMessage.trim().length > 0) {
    return topLevelMessage.trim()
  }

  const errors = recordValue(payload, "errors")
  if (!Array.isArray(errors)) {
    const messages = recordValue(payload, "messages")
    if (!Array.isArray(messages)) return fallback
    const firstMessage = messages.find(
      (message): message is string =>
        typeof message === "string" && message.trim().length > 0
    )
    return firstMessage ? firstMessage.trim() : fallback
  }

  const first = errors.find(isRecord)
  if (!first) return fallback
  const message = recordValue(first, "message")
  if (typeof message === "string" && message.trim().length > 0) {
    return message.trim()
  }

  const errorCode = recordValue(first, "code")
  return typeof errorCode === "number"
    ? `${fallback}: Cloudflare error ${errorCode}`
    : fallback
}

function nestedRecord(
  record: Readonly<Record<string, unknown>>,
  key: string
): Readonly<Record<string, unknown>> | null {
  const value = recordValue(record, key)
  return isRecord(value) ? value : null
}

function responseRecords(payload: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!isRecord(payload)) return []

  const records: Readonly<Record<string, unknown>>[] = [payload]
  const topLevelKeys = ["data", "result", "meeting", "participant"]
  for (const key of topLevelKeys) {
    const child = nestedRecord(payload, key)
    if (child) records.push(child)
  }

  const data = nestedRecord(payload, "data")
  if (data) {
    const nestedKeys = ["meeting", "participant"]
    for (const key of nestedKeys) {
      const child = nestedRecord(data, key)
      if (child) records.push(child)
    }
  }

  const result = nestedRecord(payload, "result")
  if (result) {
    const nestedKeys = ["data", "meeting", "participant"]
    for (const key of nestedKeys) {
      const child = nestedRecord(result, key)
      if (child) records.push(child)
    }
  }

  return records
}

function firstStringValue(
  records: readonly Readonly<Record<string, unknown>>[],
  keys: readonly string[]
): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = recordValue(record, key)
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim()
      }
    }
  }
  return null
}

function stringValuesForKeys(
  records: readonly Readonly<Record<string, unknown>>[],
  keys: readonly string[]
): readonly string[] {
  const values: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const key of keys) {
      const value = recordValue(record, key)
      if (typeof value !== "string") continue
      const trimmed = value.trim()
      if (trimmed.length === 0 || seen.has(trimmed)) continue
      seen.add(trimmed)
      values.push(trimmed)
    }
  }
  return values
}

function camelCaseKey(value: string): string {
  return value.replace(/([-_]\w)/g, (match) => match[1]?.toUpperCase() ?? "")
}

function camelizeRealtimeKitPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelizeRealtimeKitPayload)
  }
  if (!isRecord(value)) return value

  const next: Record<string, unknown> = {}
  for (const [key, childValue] of Object.entries(value)) {
    next[camelCaseKey(key)] = camelizeRealtimeKitPayload(childValue)
  }
  return next
}

function isCachedUserDetails(value: unknown): value is CachedUserDetails {
  if (!isRecord(value)) return false
  const userDetails = recordValue(value, "userDetails")
  const roomDetails = recordValue(value, "roomDetails")
  const iceServers = recordValue(value, "iceServers")
  const peerId = recordValue(value, "peerId")
  return (
    isRecord(userDetails) &&
    isRecord(roomDetails) &&
    Array.isArray(iceServers) &&
    iceServers.every(isRecord) &&
    (peerId === undefined || typeof peerId === "string")
  )
}

function isRealtimeKitUserDetails(value: unknown): value is UserDetailsResponseV2 {
  if (!isRecord(value)) return false
  const participant = recordValue(value, "participant")
  const preset = recordValue(value, "preset")
  const meeting = recordValue(value, "meeting")
  const socket = recordValue(value, "socket")
  return (
    isRecord(participant) &&
    isRecord(preset) &&
    isRecord(meeting) &&
    isRecord(socket) &&
    typeof recordValue(meeting, "title") === "string" &&
    typeof recordValue(socket, "baseUri") === "string"
  )
}

function iceServerFromRecord(
  record: Readonly<Record<string, unknown>>
): RealtimeKitIceServer | null {
  const urls = recordValue(record, "urls")
  const url = recordValue(record, "url")
  if (typeof urls !== "string" || typeof url !== "string") return null

  const username = recordValue(record, "username")
  const credential = recordValue(record, "credential")
  return {
    urls,
    url,
    ...(typeof username === "string" ? { username } : {}),
    ...(typeof credential === "string" ? { credential } : {}),
  }
}

function extractIceServers(payload: unknown): readonly RealtimeKitIceServer[] | null {
  const camelized = camelizeRealtimeKitPayload(payload)
  const records = responseRecords(camelized)
  for (const record of records) {
    const value = recordValue(record, "iceServers")
    if (!Array.isArray(value)) continue
    const iceServers = value.map((item) =>
      isRecord(item) ? iceServerFromRecord(item) : null
    )
    if (iceServers.every((item): item is RealtimeKitIceServer => item !== null)) {
      return iceServers
    }
  }
  return null
}

function extractCachedUserDetails(payload: unknown): CachedUserDetails | null {
  for (const record of responseRecords(payload)) {
    const camelizedDetails = camelizeRealtimeKitPayload(record)
    if (isCachedUserDetails(camelizedDetails)) return camelizedDetails
  }
  return null
}

function extractRealtimeKitUserDetails(
  payload: unknown
): UserDetailsResponseV2 | null {
  for (const record of responseRecords(payload)) {
    const camelizedDetails = camelizeRealtimeKitPayload(record)
    if (isRealtimeKitUserDetails(camelizedDetails)) return camelizedDetails
  }
  return null
}

async function getRealtimeKitIceServers(
  authToken: string
): Promise<VoiceActionResult<readonly RealtimeKitIceServer[]>> {
  const response = await fetch("https://api.realtime.cloudflare.com/iceservers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    return {
      success: false,
      error: extractApiError(
        payload,
        `Cloudflare ICE server lookup failed (${response.status})`
      ),
    }
  }

  const iceServers = extractIceServers(payload)
  return iceServers
    ? { success: true, data: iceServers }
    : { success: false, error: "Cloudflare did not return ICE servers" }
}

function extractMeeting(payload: unknown, title: string): RealtimeKitMeeting | null {
  const records = responseRecords(payload)
  const id = firstStringValue(records, ["id", "meeting_id", "meetingId"])
  if (!id) return null
  const responseTitle = firstStringValue(records, [
    "title",
    "name",
    "meeting_title",
    "meetingTitle",
  ])
  return {
    id,
    title: responseTitle ?? title,
  }
}

function extractAuthTokenCandidates(payload: unknown): readonly string[] {
  return stringValuesForKeys(responseRecords(payload), [
    "authToken",
    "auth_token",
    "participantToken",
    "participant_token",
    "token",
  ])
}

async function validateRealtimeKitParticipantToken(
  authToken: string
): Promise<VoiceActionResult<RealtimeKitParticipantToken>> {
  const response = await fetch(
    "https://api.realtime.cloudflare.com/v2/internals/participant-details",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  )
  const payload: unknown = await response.json().catch(() => null)
  if (response.ok) {
    const cachedUserDetails = extractCachedUserDetails(payload)
    if (cachedUserDetails) {
      return { success: true, data: { authToken, cachedUserDetails } }
    }

    const userDetails = extractRealtimeKitUserDetails(payload)
    if (!userDetails) {
      return {
        success: false,
        error: "Cloudflare participant details were incomplete",
      }
    }

    const iceServers = await getRealtimeKitIceServers(authToken)
    if (!iceServers.success) return iceServers

    return {
      success: true,
      data: {
        authToken,
        cachedUserDetails: {
          userDetails,
          roomDetails: { meetingTitle: userDetails.meeting.title },
          iceServers: [...iceServers.data],
        },
      },
    }
  }

  return {
    success: false,
    error: extractApiError(
      payload,
      `RealtimeKit participant token validation failed (${response.status})`
    ),
  }
}

async function realtimeKitRequest(
  config: RealtimeKitConfig,
  path: string,
  body: Readonly<Record<string, unknown>>,
  options?: { readonly retryOnGatewayError?: boolean }
): Promise<VoiceActionResult<unknown>> {
  const attempts = options?.retryOnGatewayError ? 2 : 1
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/realtime/kit/${config.appId}${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      if (
        attempt + 1 < attempts &&
        REALTIMEKIT_RETRYABLE_STATUS_CODES.has(response.status)
      ) {
        await wait(700)
        continue
      }
      return {
        success: false,
        error: extractApiError(
          payload,
          `Cloudflare RealtimeKit request failed (${response.status})`
        ),
      }
    }
    return { success: true, data: payload }
  }
  return { success: false, error: "Cloudflare RealtimeKit request failed" }
}

async function ensureRealtimeKitMeeting(
  db: ReturnType<typeof getDb>,
  config: RealtimeKitConfig,
  channel: VoiceChannelAccess,
  user: AuthUser
): Promise<VoiceActionResult<RealtimeKitMeeting>> {
  const existing = await db
    .select({
      meetingId: voiceRealtimeKitMeetings.meetingId,
      meetingTitle: voiceRealtimeKitMeetings.meetingTitle,
      createdAt: voiceRealtimeKitMeetings.createdAt,
    })
    .from(voiceRealtimeKitMeetings)
    .where(eq(voiceRealtimeKitMeetings.channelId, channel.id))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (existing) {
    if (existing.createdAt < staleRealtimeKitMeetingBeforeIso()) {
      await db
        .delete(voiceRealtimeKitMeetings)
        .where(eq(voiceRealtimeKitMeetings.channelId, channel.id))
    } else {
      return {
        success: true,
        data: { id: existing.meetingId, title: existing.meetingTitle },
      }
    }
  }

  const title = `Compass Talk - ${channel.name}`
  const meetingCreated = await realtimeKitRequest(config, "/meetings", { title })
  if (!meetingCreated.success) return meetingCreated

  const meeting = extractMeeting(meetingCreated.data, title)
  if (!meeting) {
    return { success: false, error: "Cloudflare did not return a meeting ID" }
  }

  const now = new Date().toISOString()
  await db.insert(voiceRealtimeKitMeetings).values({
    id: crypto.randomUUID(),
    channelId: channel.id,
    meetingId: meeting.id,
    meetingTitle: meeting.title,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  })

  return { success: true, data: meeting }
}

async function createRealtimeKitParticipantToken(
  config: RealtimeKitConfig,
  meetingId: string,
  participantName: string,
  participantId: string,
  presetNames: readonly string[]
): Promise<VoiceActionResult<RealtimeKitParticipantToken>> {
  let lastError = "Failed to create RealtimeKit participant"
  for (const presetName of presetNames) {
    const created = await realtimeKitRequest(
      config,
      `/meetings/${meetingId}/participants`,
      {
        custom_participant_id: participantId,
        name: participantName,
        preset_name: presetName,
      },
      { retryOnGatewayError: true }
    )
    if (!created.success) {
      lastError = created.error
      continue
    }
    const authTokens = extractAuthTokenCandidates(created.data)
    for (const authToken of authTokens) {
      const validated = await validateRealtimeKitParticipantToken(authToken)
      if (validated.success) return validated
      lastError = validated.error
    }
    if (authTokens.length === 0) {
      lastError = "Cloudflare did not return a participant token"
    }
  }
  return { success: false, error: lastError }
}

async function verifyVoiceChannelAccess(
  db: ReturnType<typeof getDb>,
  user: AuthUser,
  channelId: string
): Promise<VoiceChannelAccess | null> {
  const orgId = requireOrg(user)
  const channel = await db
    .select({
      id: channels.id,
      name: channels.name,
      organizationId: channels.organizationId,
      projectId: channels.projectId,
      type: channels.type,
      isPrivate: channels.isPrivate,
      audience: channels.audience,
      archivedAt: channels.archivedAt,
    })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (
    !channel ||
    channel.organizationId !== orgId ||
    channel.type !== "voice" ||
    channel.archivedAt !== null
  ) {
    return null
  }

  const membership = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (membership || can(user, "channels", "moderate")) {
    return channel
  }

  if (channel.isPrivate) {
    return null
  }

  if (channel.audience === "organization") {
    return channel
  }

  if (channel.audience === "staff" && isInternalStaffRole(user.role)) {
    return channel
  }

  const projectRoleCondition =
    channel.audience === "clients"
      ? eq(projectMembers.role, "owner")
      : inArray(projectMembers.role, ["supplier", "subcontractor"])

  const projectMembership = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, user.id),
        projectRoleCondition,
        channel.projectId
          ? eq(projectMembers.projectId, channel.projectId)
          : undefined
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return projectMembership ? channel : null
}

async function cleanupVoiceSession(
  db: ReturnType<typeof getDb>,
  channelId: string
): Promise<void> {
  const now = Date.now()
  await db
    .delete(voiceParticipants)
    .where(
      and(
        eq(voiceParticipants.channelId, channelId),
        sql`${voiceParticipants.lastSeenAt} < ${activeAfterIso(now)}`
      )
    )
  await db
    .delete(voiceSignals)
    .where(
      and(
        eq(voiceSignals.channelId, channelId),
        sql`${voiceSignals.createdAt} < ${staleSignalBeforeIso(now)}`
      )
    )
}

async function listActiveParticipants(
  db: ReturnType<typeof getDb>,
  channelId: string
): Promise<readonly VoiceParticipantData[]> {
  const rows = await db
    .select({
      userId: voiceParticipants.userId,
      displayName: voiceParticipants.displayName,
      userDisplayName: users.displayName,
      email: users.email,
      isMuted: voiceParticipants.isMuted,
      isDeafened: voiceParticipants.isDeafened,
      joinedAt: voiceParticipants.joinedAt,
      lastSeenAt: voiceParticipants.lastSeenAt,
    })
    .from(voiceParticipants)
    .leftJoin(users, eq(users.id, voiceParticipants.userId))
    .where(
      and(
        eq(voiceParticipants.channelId, channelId),
        gt(voiceParticipants.lastSeenAt, activeAfterIso())
      )
    )
    .orderBy(voiceParticipants.joinedAt)

  return rows.map((row) => ({
    userId: row.userId,
    displayName:
      row.displayName ?? row.userDisplayName ?? row.email?.split("@")[0] ?? null,
    isMuted: row.isMuted,
    isDeafened: row.isDeafened,
    joinedAt: row.joinedAt,
    lastSeenAt: row.lastSeenAt,
  }))
}

export async function joinVoiceSession(
  channelId: string,
  state?: { readonly isMuted?: boolean; readonly isDeafened?: boolean }
): Promise<
  VoiceActionResult<{
    readonly self: VoiceParticipantData
    readonly participants: readonly VoiceParticipantData[]
  }>
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    const now = new Date().toISOString()
    await cleanupVoiceSession(db, channelId)
    await db
      .delete(voiceParticipants)
      .where(eq(voiceParticipants.userId, user.id))
    await db.insert(voiceParticipants).values({
      id: crypto.randomUUID(),
      channelId,
      userId: user.id,
      displayName: displayNameForUser(user),
      isMuted: state?.isMuted ?? false,
      isDeafened: state?.isDeafened ?? false,
      joinedAt: now,
      lastSeenAt: now,
    })

    const participants = await listActiveParticipants(db, channelId)
    const self = participants.find((participant) => participant.userId === user.id)
    if (!self) {
      return { success: false, error: "Failed to join voice channel" }
    }

    return { success: true, data: { self, participants } }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to join voice channel",
    }
  }
}

export async function joinRealtimeKitVoiceSession(
  channelId: string,
  options?: RealtimeKitJoinOptions
): Promise<VoiceActionResult<RealtimeKitJoinData>> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const { env } = await getCloudflareContext()
    const config = realtimeKitConfigFromEnv(env)
    if (!config) {
      return {
        success: false,
        error: "Cloudflare RealtimeKit is not configured yet",
      }
    }

    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    if (options?.resetMeeting) {
      const activeParticipants = await listActiveParticipants(db, channelId)
      const otherActiveParticipants = activeParticipants.filter(
        (participant) => participant.userId !== user.id
      )
      if (otherActiveParticipants.length > 0) {
        return {
          success: false,
          error:
            "Cannot reset this meeting while other participants are still connected.",
        }
      }
      await db
        .delete(voiceRealtimeKitMeetings)
        .where(eq(voiceRealtimeKitMeetings.channelId, channelId))
    }

    const meeting = await ensureRealtimeKitMeeting(db, config, channel, user)
    if (!meeting.success) return { success: false, error: meeting.error }

    const participantName = displayNameForUser(user)
    const presetNames = can(user, "channels", "moderate")
      ? ["host", "group_call_host", "participant", "group_call_participant"]
      : ["participant", "group_call_participant", "host", "group_call_host"]
    const authToken = await createRealtimeKitParticipantToken(
      config,
      meeting.data.id,
      participantName,
      `${user.id}-${crypto.randomUUID()}`,
      presetNames
    )
    if (!authToken.success) return { success: false, error: authToken.error }

    return {
      success: true,
      data: {
        authToken: authToken.data.authToken,
        cachedUserDetails: authToken.data.cachedUserDetails,
        meetingId: meeting.data.id,
        meetingTitle: meeting.data.title,
        participantName,
      },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to join Cloudflare meeting",
    }
  }
}

export async function leaveVoiceSession(
  channelId: string
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    await db
      .delete(voiceParticipants)
      .where(
        and(
          eq(voiceParticipants.channelId, channelId),
          eq(voiceParticipants.userId, user.id)
        )
      )
    await db
      .delete(voiceSignals)
      .where(
        and(
          eq(voiceSignals.channelId, channelId),
          eq(voiceSignals.targetUserId, user.id)
        )
      )
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to leave voice channel",
    }
  }
}

export async function updateVoicePresence(
  channelId: string,
  state: { readonly isMuted: boolean; readonly isDeafened: boolean }
): Promise<VoiceActionResult<{ readonly participants: readonly VoiceParticipantData[] }>> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    await cleanupVoiceSession(db, channelId)
    await db
      .update(voiceParticipants)
      .set({
        isMuted: state.isMuted,
        isDeafened: state.isDeafened,
        lastSeenAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(voiceParticipants.channelId, channelId),
          eq(voiceParticipants.userId, user.id)
        )
      )

    return {
      success: true,
      data: { participants: await listActiveParticipants(db, channelId) },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update voice state",
    }
  }
}

export async function sendVoiceSignal(input: {
  readonly channelId: string
  readonly targetUserId: string
  readonly signalType: VoiceSignalType
  readonly payloadJson: string
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const signalType = normalizeSignalType(input.signalType)
    if (!signalType) return { success: false, error: "Invalid signal type" }
    if (input.payloadJson.length > 64_000) {
      return { success: false, error: "Signal payload is too large" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, input.channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    const target = await db
      .select({ id: voiceParticipants.id })
      .from(voiceParticipants)
      .where(
        and(
          eq(voiceParticipants.channelId, input.channelId),
          eq(voiceParticipants.userId, input.targetUserId),
          gt(voiceParticipants.lastSeenAt, activeAfterIso())
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!target) return { success: false, error: "Recipient is not in voice" }

    await db.insert(voiceSignals).values({
      id: crypto.randomUUID(),
      channelId: input.channelId,
      senderUserId: user.id,
      targetUserId: input.targetUserId,
      signalType,
      payloadJson: input.payloadJson,
      createdAt: new Date().toISOString(),
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to send voice signal",
    }
  }
}

export async function pollVoiceSession(
  channelId: string,
  afterSignalCreatedAt?: string
): Promise<
  VoiceActionResult<{
    readonly participants: readonly VoiceParticipantData[]
    readonly signals: readonly VoiceSignalData[]
  }>
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    await cleanupVoiceSession(db, channelId)
    await db
      .update(voiceParticipants)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(
        and(
          eq(voiceParticipants.channelId, channelId),
          eq(voiceParticipants.userId, user.id)
        )
      )

    const signalRows = await db
      .select({
        id: voiceSignals.id,
        senderUserId: voiceSignals.senderUserId,
        signalType: voiceSignals.signalType,
        payloadJson: voiceSignals.payloadJson,
        createdAt: voiceSignals.createdAt,
      })
      .from(voiceSignals)
      .where(
        and(
          eq(voiceSignals.channelId, channelId),
          eq(voiceSignals.targetUserId, user.id),
          afterSignalCreatedAt
            ? gt(voiceSignals.createdAt, afterSignalCreatedAt)
            : undefined
        )
      )
      .orderBy(voiceSignals.createdAt)
      .limit(100)

    const signals: VoiceSignalData[] = []
    for (const row of signalRows) {
      const signalType = normalizeSignalType(row.signalType)
      if (signalType) {
        signals.push({
          id: row.id,
          senderUserId: row.senderUserId,
          signalType,
          payloadJson: row.payloadJson,
          createdAt: row.createdAt,
        })
      }
    }

    return {
      success: true,
      data: {
        participants: await listActiveParticipants(db, channelId),
        signals,
      },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to poll voice channel",
    }
  }
}
