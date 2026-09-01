"use server"

import { and, asc, desc, eq, inArray, isNull, not, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { dailyLogPhotos, projects } from "@/db/schema"
import {
  socialAccounts,
  socialPostMedia,
  socialPostTargets,
  socialPosts,
  socialProjectAlbums,
} from "@/db/schema-social"
import { requireAuth } from "@/lib/auth"
import { decrypt, encrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { dailyLogPhotoCollectionEligibility } from "@/lib/photos/collection-eligibility"
import { getProjectAccessRecord } from "@/lib/project-access"
import { projectDepartment } from "@/lib/project-branding"
import { recordActivityEvent } from "@/lib/activity-log"
import { environmentString, getSocialConfig, socialTokenSalt } from "@/lib/social/config"
import { createSignedSocialPhotoUrl } from "@/lib/social/media-signing"
import {
  isSupportedSocialImageMimeType,
  normalizeSocialImageMimeType,
  sanitizeSocialImage,
} from "@/lib/social/image-sanitization"
import {
  createFacebookProjectAlbum,
  findFacebookAlbumByName,
  publishFacebookPhotos,
  publishInstagramPhotos,
} from "@/lib/social/meta"
import {
  normalizeHashtags,
  socialCopyPrivacyViolations,
  socialPostText,
  validatePublicProjectIdentity,
} from "@/lib/social/privacy"
import {
  socialPlatform,
  type FacebookAlbumMode,
  type SocialDraftSuggestion,
  type SocialPlatform,
} from "@/lib/social/types"
import {
  publishXPost,
  refreshXAccessToken,
  uploadXImage,
} from "@/lib/social/x"
import {
  freshestXAccessAccount,
  newestXRefreshAccount,
} from "@/lib/social/x-account-sharing"
import { isInternalStaffRole } from "@/lib/user-roles"

type SocialResult =
  | { readonly success: true; readonly postId: string }
  | { readonly success: false; readonly error: string }

type SuggestionResult =
  | { readonly success: true; readonly suggestion: SocialDraftSuggestion }
  | { readonly success: false; readonly error: string }

export type SocialPostWorkspace = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly department: string
    readonly publicTitle: string | null
    readonly publicLocationCity: string | null
    readonly privacyReady: boolean
    readonly privacyErrors: readonly string[]
  }
  readonly canPublish: boolean
  readonly accounts: readonly {
    readonly id: string
    readonly platform: SocialPlatform
    readonly accountName: string
  }[]
  readonly photos: readonly {
    readonly id: string
    readonly fileName: string
    readonly mimeType: string | null
    readonly thumbnailUrl: string | null
    readonly driveFileId: string | null
    readonly caption: string | null
    readonly capturedAt: string | null
  }[]
  readonly posts: readonly {
    readonly id: string
    readonly heading: string
    readonly body: string
    readonly hashtags: readonly string[]
    readonly status: string
    readonly createdAt: string
    readonly publishedAt: string | null
    readonly photoIds: readonly string[]
    readonly targets: readonly {
      readonly platform: string
      readonly facebookAlbumMode: string
      readonly status: string
      readonly externalPostUrl: string | null
      readonly error: string | null
    }[]
  }[]
}

type SocialContext = {
  readonly db: ReturnType<typeof getDb>
  readonly env: Awaited<ReturnType<typeof getCloudflareContext>>["env"]
  readonly organizationId: string
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly publicTitle: string | null
    readonly publicLocationCity: string | null
    readonly clientName: string | null
    readonly address: string | null
  }
}

function parseHashtags(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? normalizeHashtags(parsed.filter((item): item is string => typeof item === "string"))
      : []
  } catch {
    return []
  }
}

function publicIdentityErrors(project: SocialContext["project"]): readonly string[] {
  if (!project.publicTitle || !project.publicLocationCity) {
    return ["Add a privacy-safe public title and town/city before creating a post."]
  }
  return validatePublicProjectIdentity({
    publicTitle: project.publicTitle,
    locationCity: project.publicLocationCity,
    internalProjectName: project.name,
    clientName: project.clientName,
  })
}

async function socialContext(
  projectId: string,
  action: "read" | "create" | "update" | "delete" | "approve",
): Promise<SocialContext> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "social-publishing", action)
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Social publishing is available to internal staff only.")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const access = await getProjectAccessRecord(db, user, projectId)
  if (!access || access.organizationId !== organizationId) {
    throw new Error("Project not found or access denied.")
  }
  const project = await db.select({
    id: projects.id,
    name: projects.name,
    projectNumber: projects.projectNumber,
    publicTitle: projects.publicTitle,
    publicLocationCity: projects.publicLocationCity,
    clientName: projects.clientName,
    address: projects.address,
  }).from(projects).where(and(
    eq(projects.id, projectId),
    eq(projects.organizationId, organizationId),
  )).get()
  if (!project) throw new Error("Project not found or access denied.")
  return { db, env, organizationId, user, project }
}

function revalidateSocial(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/social`)
  revalidatePath("/dashboard")
}

export async function getSocialPostWorkspace(projectId: string): Promise<SocialPostWorkspace> {
  const context = await socialContext(projectId, "read")
  const department = projectDepartment({
    projectId: context.project.id,
    projectNumber: context.project.projectNumber,
  })
  const [accountRows, photoRows, postRows] = await context.db.batch([
    context.db.select({
      id: socialAccounts.id,
      platform: socialAccounts.platform,
      accountName: socialAccounts.accountName,
    }).from(socialAccounts).where(and(
      eq(socialAccounts.organizationId, context.organizationId),
      eq(socialAccounts.department, department),
      eq(socialAccounts.status, "connected"),
    )),
    context.db.select({
      id: dailyLogPhotos.id,
      fileName: dailyLogPhotos.fileName,
      mimeType: dailyLogPhotos.mimeType,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      driveFileId: dailyLogPhotos.driveFileId,
      caption: dailyLogPhotos.caption,
      capturedAt: dailyLogPhotos.capturedAt,
    }).from(dailyLogPhotos).where(and(
      eq(dailyLogPhotos.projectId, projectId),
      eq(dailyLogPhotos.reviewStatus, "approved"),
      eq(dailyLogPhotos.publicShareable, true),
      dailyLogPhotoCollectionEligibility(),
      not(sql<boolean>`EXISTS (
        SELECT 1
        FROM daily_log_photo_aliases AS alias
        JOIN daily_log_photos AS canonical
          ON canonical.id IS alias.canonical_photo_id
        WHERE alias.source_photo_id IS ${dailyLogPhotos.id}
          AND alias.project_id IS ${dailyLogPhotos.projectId}
          AND canonical.project_id IS ${dailyLogPhotos.projectId}
          AND canonical.mime_type LIKE 'image/%'
          AND canonical.drive_file_id IS NOT NULL
          AND (
            canonical.drive_file_id IS NOT NULL
            OR canonical.thumbnail_url IS NOT NULL
          )
          AND canonical.review_status IS 'approved'
          AND canonical.public_shareable IS 1
      )`),
    )).orderBy(desc(dailyLogPhotos.capturedAt), desc(dailyLogPhotos.createdAt)),
    context.db.select({
      id: socialPosts.id,
      heading: socialPosts.heading,
      body: socialPosts.body,
      hashtagsJson: socialPosts.hashtagsJson,
      status: socialPosts.status,
      createdAt: socialPosts.createdAt,
      publishedAt: socialPosts.publishedAt,
    }).from(socialPosts).where(and(
      eq(socialPosts.projectId, projectId),
      isNull(socialPosts.deletedAt),
    )).orderBy(desc(socialPosts.createdAt)),
  ])
  const postIds = postRows.map((post) => post.id)
  const targetRows = postIds.length > 0
    ? await context.db.select({
        postId: socialPostTargets.postId,
        platform: socialPostTargets.platform,
        facebookAlbumMode: socialPostTargets.facebookAlbumMode,
        status: socialPostTargets.status,
        externalPostUrl: socialPostTargets.externalPostUrl,
        error: socialPostTargets.error,
      }).from(socialPostTargets).where(inArray(socialPostTargets.postId, postIds))
    : []
  const mediaRows = postIds.length > 0
    ? await context.db.select({
        postId: socialPostMedia.postId,
        photoId: socialPostMedia.photoId,
        sortOrder: socialPostMedia.sortOrder,
      }).from(socialPostMedia).where(
        inArray(socialPostMedia.postId, postIds),
      ).orderBy(asc(socialPostMedia.sortOrder))
    : []
  const errors = publicIdentityErrors(context.project)
  return {
    project: {
      id: context.project.id,
      name: context.project.name,
      projectNumber: context.project.projectNumber,
      department,
      publicTitle: context.project.publicTitle,
      publicLocationCity: context.project.publicLocationCity,
      privacyReady: errors.length === 0,
      privacyErrors: errors,
    },
    canPublish: await (async () => {
      try {
        await requireFeaturePermission(context.user, "social-publishing", "approve")
        return true
      } catch {
        return false
      }
    })(),
    accounts: accountRows.flatMap((account) => {
      const platform = socialPlatform(account.platform)
      return platform ? [{ ...account, platform }] : []
    }),
    photos: photoRows,
    posts: postRows.map((post) => ({
      id: post.id,
      heading: post.heading,
      body: post.body,
      hashtags: parseHashtags(post.hashtagsJson),
      status: post.status,
      createdAt: post.createdAt,
      publishedAt: post.publishedAt,
      photoIds: mediaRows.filter((media) => media.postId === post.id).map((media) => media.photoId),
      targets: targetRows.filter((target) => target.postId === post.id).map((target) => ({
        platform: target.platform,
        facebookAlbumMode: target.facebookAlbumMode,
        status: target.status,
        externalPostUrl: target.externalPostUrl,
        error: target.error,
      })),
    })),
  }
}

function selectedPlatforms(values: readonly string[]): readonly SocialPlatform[] {
  const platforms: SocialPlatform[] = []
  for (const value of values) {
    const platform = socialPlatform(value)
    if (platform && !platforms.includes(platform)) platforms.push(platform)
  }
  return platforms
}

function cleanCopy(input: {
  readonly heading: string
  readonly body: string
  readonly hashtags: readonly string[]
}): { readonly heading: string; readonly body: string; readonly hashtags: readonly string[] } {
  return {
    heading: input.heading.trim().slice(0, 120),
    body: input.body.trim().slice(0, 2_000),
    hashtags: normalizeHashtags(input.hashtags),
  }
}

export async function saveSocialPostDraft(input: {
  readonly projectId: string
  readonly postId?: string
  readonly heading: string
  readonly body: string
  readonly hashtags: readonly string[]
  readonly photoIds: readonly string[]
  readonly platforms: readonly string[]
  readonly facebookAlbumMode: FacebookAlbumMode
}): Promise<SocialResult> {
  let createdId: string | null = null
  try {
    const context = await socialContext(input.projectId, input.postId ? "update" : "create")
    const identityErrors = publicIdentityErrors(context.project)
    if (identityErrors.length > 0) return { success: false, error: identityErrors.join(" ") }
    const copy = cleanCopy(input)
    if (!copy.heading || !copy.body) {
      return { success: false, error: "Add both a heading and post text." }
    }
    const violations = socialCopyPrivacyViolations(
      socialPostText(copy),
      {
        publicTitle: context.project.publicTitle,
        publicLocationCity: context.project.publicLocationCity,
        internalProjectName: context.project.name,
        clientName: context.project.clientName,
        siteAddress: context.project.address,
      },
    )
    if (violations.length > 0) {
      return { success: false, error: `Remove privacy-sensitive content: ${violations.join(", ")}.` }
    }
    const platforms = selectedPlatforms(input.platforms)
    if (platforms.length === 0) {
      return { success: false, error: "Choose at least one connected social destination." }
    }
    if (platforms.includes("x") && socialPostText(copy).length > 280) {
      return { success: false, error: "X posts must be 280 characters or fewer, including hashtags." }
    }
    const department = projectDepartment({
      projectId: context.project.id,
      projectNumber: context.project.projectNumber,
    })
    const accounts = await context.db.select().from(socialAccounts).where(and(
      eq(socialAccounts.organizationId, context.organizationId),
      eq(socialAccounts.department, department),
      eq(socialAccounts.status, "connected"),
      inArray(socialAccounts.platform, platforms),
    ))
    if (accounts.length !== platforms.length) {
      return { success: false, error: "Connect every selected department destination first." }
    }
    const uniquePhotoIds = [...new Set(input.photoIds)].slice(0, 10)
    const photos = uniquePhotoIds.length > 0
      ? await context.db.select({
          id: dailyLogPhotos.id,
          mimeType: dailyLogPhotos.mimeType,
        }).from(dailyLogPhotos).where(and(
          eq(dailyLogPhotos.projectId, input.projectId),
          eq(dailyLogPhotos.reviewStatus, "approved"),
          eq(dailyLogPhotos.publicShareable, true),
          inArray(dailyLogPhotos.id, uniquePhotoIds),
        ))
      : []
    if (photos.length !== uniquePhotoIds.length) {
      return { success: false, error: "Only approved, public-shareable project photos may be posted." }
    }
    if (photos.some((photo) => !isSupportedSocialImageMimeType(photo.mimeType))) {
      return { success: false, error: "Social publishing supports JPEG, PNG, and WebP photos only." }
    }
    if (platforms.includes("instagram") && photos.length === 0) {
      return { success: false, error: "Instagram posts require at least one photo." }
    }
    if (
      platforms.includes("instagram") &&
      photos.some((photo) =>
        photo.mimeType === null || normalizeSocialImageMimeType(photo.mimeType) !== "image/jpeg"
      )
    ) {
      return { success: false, error: "Instagram publishing currently requires JPEG photos." }
    }
    if (platforms.includes("x") && photos.length > 4) {
      return { success: false, error: "X supports up to four photos per post." }
    }

    const now = new Date().toISOString()
    const postId = input.postId ?? crypto.randomUUID()
    if (input.postId) {
      const existing = await context.db.select({ id: socialPosts.id }).from(socialPosts).where(and(
        eq(socialPosts.id, input.postId),
        eq(socialPosts.projectId, input.projectId),
        eq(socialPosts.organizationId, context.organizationId),
        eq(socialPosts.status, "draft"),
        isNull(socialPosts.deletedAt),
      )).get()
      if (!existing) return { success: false, error: "Only active drafts can be edited." }
      await context.db.update(socialPosts).set({
        heading: copy.heading,
        body: copy.body,
        hashtagsJson: JSON.stringify(copy.hashtags),
        publicTitleSnapshot: context.project.publicTitle ?? "",
        locationCitySnapshot: context.project.publicLocationCity ?? "",
        updatedAt: now,
      }).where(eq(socialPosts.id, input.postId)).run()
      await context.db.delete(socialPostMedia).where(eq(socialPostMedia.postId, input.postId)).run()
      await context.db.delete(socialPostTargets).where(eq(socialPostTargets.postId, input.postId)).run()
    } else {
      createdId = postId
      await context.db.insert(socialPosts).values({
        id: postId,
        organizationId: context.organizationId,
        projectId: input.projectId,
        department,
        publicTitleSnapshot: context.project.publicTitle ?? "",
        locationCitySnapshot: context.project.publicLocationCity ?? "",
        heading: copy.heading,
        body: copy.body,
        hashtagsJson: JSON.stringify(copy.hashtags),
        status: "draft",
        createdBy: context.user.id,
        reviewedBy: null,
        reviewedAt: null,
        publishedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
    }
    for (let index = 0; index < uniquePhotoIds.length; index += 1) {
      const photoId = uniquePhotoIds[index]
      if (!photoId) continue
      await context.db.insert(socialPostMedia).values({
        id: crypto.randomUUID(),
        postId,
        photoId,
        sortOrder: index,
        altText: null,
        createdAt: now,
      }).run()
    }
    for (const account of accounts) {
      await context.db.insert(socialPostTargets).values({
        id: crypto.randomUUID(),
        postId,
        accountId: account.id,
        platform: account.platform,
        facebookAlbumMode:
          account.platform === "facebook" ? input.facebookAlbumMode : "none",
        status: "pending",
        externalPostId: null,
        externalPostUrl: null,
        error: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
    }
    await recordActivityEvent({
      db: context.db,
      organizationId: context.organizationId,
      projectId: input.projectId,
      actor: context.user,
      category: "social",
      action: input.postId ? "social_post_updated" : "social_post_created",
      entityType: "social_post",
      entityId: postId,
      summary: `${input.postId ? "Updated" : "Created"} social post draft “${copy.heading}”.`,
    })
    revalidateSocial(input.projectId)
    return { success: true, postId }
  } catch (error) {
    if (createdId) {
      try {
        const { env } = await getCloudflareContext()
        await getDb(env.DB).delete(socialPosts).where(eq(socialPosts.id, createdId)).run()
      } catch {
        // A partially-created draft remains visible for an administrator to review.
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to save the social post draft.",
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function extractJsonObject(value: string): Readonly<Record<string, unknown>> | null {
  const start = value.indexOf("{")
  const end = value.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(value.slice(start, end + 1))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function suggestSocialPost(input: {
  readonly projectId: string
  readonly photoIds: readonly string[]
}): Promise<SuggestionResult> {
  try {
    const context = await socialContext(input.projectId, "create")
    const identityErrors = publicIdentityErrors(context.project)
    if (identityErrors.length > 0) return { success: false, error: identityErrors.join(" ") }
    const photoIds = [...new Set(input.photoIds)].slice(0, 4)
    if (photoIds.length === 0) {
      return { success: false, error: "Choose at least one approved public photo for AI suggestions." }
    }
    const photos = await context.db.select({
      id: dailyLogPhotos.id,
      mimeType: dailyLogPhotos.mimeType,
    }).from(dailyLogPhotos).where(and(
      eq(dailyLogPhotos.projectId, input.projectId),
      eq(dailyLogPhotos.reviewStatus, "approved"),
      eq(dailyLogPhotos.publicShareable, true),
      inArray(dailyLogPhotos.id, photoIds),
    )).orderBy(asc(dailyLogPhotos.sortOrder))
    if (photos.length !== photoIds.length) {
      return { success: false, error: "AI suggestions only use approved public-shareable photos." }
    }
    if (photos.some((photo) => !isSupportedSocialImageMimeType(photo.mimeType))) {
      return { success: false, error: "AI suggestions support JPEG, PNG, and WebP photos only." }
    }
    const apiKey = environmentString(context.env, "OPENROUTER_API_KEY")
    if (!apiKey) {
      return {
        success: true,
        suggestion: {
          heading: context.project.publicTitle ?? "Project progress",
          body: `A look at recent progress on our ${context.project.publicTitle ?? "project"} in ${context.project.publicLocationCity ?? "the local area"}.`,
          hashtags: ["#Construction", "#ProjectProgress", "#BuiltWithCare"],
        },
      }
    }
    const config = getSocialConfig(context.env)
    const imageParts: Readonly<Record<string, unknown>>[] = []
    for (const photo of photos) {
      imageParts.push({
        type: "image_url",
        image_url: {
          url: await createSignedSocialPhotoUrl({
            baseUrl: config.publicBaseUrl,
            photoId: photo.id,
            key: config.tokenEncryptionKey,
          }),
        },
      })
    }
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.publicBaseUrl,
        "X-Title": "Compass Social Publishing",
      },
      body: JSON.stringify({
        model: config.aiModel,
        temperature: 0.5,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `Suggest professional construction social copy from these photos. Return JSON only with heading, body, and hashtags (array). Use only this public identity: title “${context.project.publicTitle}”; town/city “${context.project.publicLocationCity}”. Never infer or mention a client, person, street, exact address, coordinates, house number, schedule, cost, security detail, or exact capture date. Keep the heading under 80 characters, body under 700 characters, and use at most 8 relevant hashtags.`,
            },
            ...imageParts,
          ],
        }],
      }),
    })
    const payload: unknown = await response.json()
    const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : []
    const firstChoice = choices.find(isRecord)
    const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null
    const content = message && typeof message.content === "string" ? message.content : null
    if (!response.ok || !content) throw new Error(`AI suggestion failed (${response.status}).`)
    const parsed = extractJsonObject(content)
    const heading = parsed && typeof parsed.heading === "string" ? parsed.heading.trim() : ""
    const body = parsed && typeof parsed.body === "string" ? parsed.body.trim() : ""
    const hashtags = parsed && Array.isArray(parsed.hashtags)
      ? normalizeHashtags(parsed.hashtags.filter((value): value is string => typeof value === "string"))
      : []
    if (!heading || !body) throw new Error("AI returned incomplete social copy.")
    const suggestion = cleanCopy({ heading, body, hashtags })
    const violations = socialCopyPrivacyViolations(socialPostText(suggestion), {
      publicTitle: context.project.publicTitle,
      publicLocationCity: context.project.publicLocationCity,
      internalProjectName: context.project.name,
      clientName: context.project.clientName,
      siteAddress: context.project.address,
    })
    if (violations.length > 0) {
      return { success: false, error: "The AI suggestion was blocked by the project privacy check." }
    }
    return { success: true, suggestion }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to suggest social copy.",
    }
  }
}

async function synchronizeXCredentials(input: {
  readonly context: SocialContext
  readonly accounts: readonly (typeof socialAccounts.$inferSelect)[]
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly tokenExpiresAt: string
  readonly grantedScopes: string
}): Promise<void> {
  const config = getSocialConfig(input.context.env)
  const credentialValues = await Promise.all(input.accounts.map(async (account) => {
    const salt = socialTokenSalt({
      organizationId: input.context.organizationId,
      platform: "x",
      department: account.department,
    })
    const accessTokenEncrypted = await encrypt(
      input.accessToken,
      config.tokenEncryptionKey,
      salt,
    )
    const refreshTokenEncrypted = input.refreshToken
      ? await encrypt(input.refreshToken, config.tokenEncryptionKey, salt)
      : account.refreshTokenEncrypted
    return { account, accessTokenEncrypted, refreshTokenEncrypted }
  }))
  const statements = credentialValues.map((value) =>
    input.context.db.update(socialAccounts).set({
      accessTokenEncrypted: value.accessTokenEncrypted,
      refreshTokenEncrypted: value.refreshTokenEncrypted,
      tokenExpiresAt: input.tokenExpiresAt,
      grantedScopes: input.grantedScopes,
      lastError: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(socialAccounts.id, value.account.id)),
  )
  const [firstStatement, ...remainingStatements] = statements
  if (!firstStatement) throw new Error("Reconnect the X account before publishing.")
  await input.context.db.batch([firstStatement, ...remainingStatements])
}

async function xAccessToken(input: {
  readonly context: SocialContext
  readonly account: typeof socialAccounts.$inferSelect
}): Promise<string> {
  const config = getSocialConfig(input.context.env)
  const sharedAccounts = await input.context.db.select().from(socialAccounts).where(and(
    eq(socialAccounts.organizationId, input.context.organizationId),
    eq(socialAccounts.platform, "x"),
    eq(socialAccounts.externalAccountId, input.account.externalAccountId),
    eq(socialAccounts.status, "connected"),
  )).all()
  const freshAccount = freshestXAccessAccount(sharedAccounts, Date.now())
  if (freshAccount && freshAccount.tokenExpiresAt) {
    const freshSalt = socialTokenSalt({
      organizationId: input.context.organizationId,
      platform: "x",
      department: freshAccount.department,
    })
    const accessToken = await decrypt(
      freshAccount.accessTokenEncrypted,
      config.tokenEncryptionKey,
      freshSalt,
    )
    const refreshToken = freshAccount.refreshTokenEncrypted
      ? await decrypt(
          freshAccount.refreshTokenEncrypted,
          config.tokenEncryptionKey,
          freshSalt,
        )
      : null
    await synchronizeXCredentials({
      context: input.context,
      accounts: sharedAccounts,
      accessToken,
      refreshToken,
      tokenExpiresAt: freshAccount.tokenExpiresAt,
      grantedScopes: freshAccount.grantedScopes,
    })
    return accessToken
  }
  const refreshAccount = newestXRefreshAccount(sharedAccounts)
  if (!refreshAccount?.refreshTokenEncrypted || !config.xClientId) {
    throw new Error("Reconnect the X account before publishing.")
  }
  const refreshSalt = socialTokenSalt({
    organizationId: input.context.organizationId,
    platform: "x",
    department: refreshAccount.department,
  })
  const refreshToken = await decrypt(
    refreshAccount.refreshTokenEncrypted,
    config.tokenEncryptionKey,
    refreshSalt,
  )
  const grant = await refreshXAccessToken({
    clientId: config.xClientId,
    clientSecret: config.xClientSecret,
    refreshToken,
  })
  await synchronizeXCredentials({
    context: input.context,
    accounts: sharedAccounts,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    tokenExpiresAt: new Date(Date.now() + grant.expiresIn * 1000).toISOString(),
    grantedScopes: [...grant.scopes].sort().join(" "),
  })
  return grant.accessToken
}

export async function publishSocialPost(input: {
  readonly projectId: string
  readonly postId: string
  readonly confirmPublish: boolean
}): Promise<SocialResult> {
  try {
    if (!input.confirmPublish) {
      return { success: false, error: "Confirm that the post is approved for public publishing." }
    }
    const context = await socialContext(input.projectId, "approve")
    const post = await context.db.select().from(socialPosts).where(and(
      eq(socialPosts.id, input.postId),
      eq(socialPosts.projectId, input.projectId),
      eq(socialPosts.organizationId, context.organizationId),
      isNull(socialPosts.deletedAt),
    )).get()
    if (!post || (post.status !== "draft" && post.status !== "failed" && post.status !== "partial")) {
      return { success: false, error: "This post is not ready to publish." }
    }
    const identityErrors = publicIdentityErrors(context.project)
    if (identityErrors.length > 0) return { success: false, error: identityErrors.join(" ") }
    const hashtags = parseHashtags(post.hashtagsJson)
    const text = socialPostText({ heading: post.heading, body: post.body, hashtags })
    const violations = socialCopyPrivacyViolations(text, {
      publicTitle: context.project.publicTitle,
      publicLocationCity: context.project.publicLocationCity,
      internalProjectName: context.project.name,
      clientName: context.project.clientName,
      siteAddress: context.project.address,
    })
    if (violations.length > 0) {
      return { success: false, error: `Publishing blocked by privacy check: ${violations.join(", ")}.` }
    }
    const mediaRows = await context.db.select({
      photoId: socialPostMedia.photoId,
      driveFileId: dailyLogPhotos.driveFileId,
      mimeType: dailyLogPhotos.mimeType,
      fileSize: dailyLogPhotos.fileSize,
      reviewStatus: dailyLogPhotos.reviewStatus,
      publicShareable: dailyLogPhotos.publicShareable,
    }).from(socialPostMedia).innerJoin(
      dailyLogPhotos,
      eq(dailyLogPhotos.id, socialPostMedia.photoId),
    ).where(eq(socialPostMedia.postId, post.id)).orderBy(asc(socialPostMedia.sortOrder))
    if (mediaRows.some((media) => media.reviewStatus !== "approved" || !media.publicShareable)) {
      return { success: false, error: "A selected photo is no longer approved for public sharing." }
    }
    if (mediaRows.some((media) => !isSupportedSocialImageMimeType(media.mimeType))) {
      return { success: false, error: "Social publishing supports JPEG, PNG, and WebP photos only." }
    }
    const allTargets = await context.db.select({
      target: socialPostTargets,
      account: socialAccounts,
    }).from(socialPostTargets).innerJoin(
      socialAccounts,
      eq(socialAccounts.id, socialPostTargets.accountId),
    ).where(and(
      eq(socialPostTargets.postId, post.id),
      eq(socialAccounts.organizationId, context.organizationId),
      eq(socialAccounts.status, "connected"),
    ))
    if (allTargets.length === 0) return { success: false, error: "No connected destinations remain." }
    const targets = allTargets.filter((row) => row.target.status !== "published")
    if (targets.length === 0) {
      return { success: false, error: "Every destination for this post is already published." }
    }

    const now = new Date().toISOString()
    const config = getSocialConfig(context.env)
    const photoUrls: string[] = []
    const instagramPhotoUrls: string[] = []
    for (const media of mediaRows) {
      photoUrls.push(await createSignedSocialPhotoUrl({
        baseUrl: config.publicBaseUrl,
        photoId: media.photoId,
        key: config.tokenEncryptionKey,
        lifetimeSeconds: 20 * 60,
      }))
      instagramPhotoUrls.push(await createSignedSocialPhotoUrl({
        baseUrl: config.publicBaseUrl,
        photoId: media.photoId,
        key: config.tokenEncryptionKey,
        variant: "instagram",
        lifetimeSeconds: 20 * 60,
      }))
    }
    const claim = await context.db.update(socialPosts).set({
      status: "publishing",
      reviewedBy: context.user.id,
      reviewedAt: now,
      updatedAt: now,
    }).where(and(
      eq(socialPosts.id, post.id),
      inArray(socialPosts.status, ["draft", "failed", "partial"]),
      isNull(socialPosts.deletedAt),
    )).run()
    if ((claim.meta.changes ?? 0) !== 1) {
      return { success: false, error: "This post is already being published or is no longer ready." }
    }
    let successes = 0
    for (const row of targets) {
      try {
        const platform = socialPlatform(row.target.platform)
        if (!platform) throw new Error("Unsupported social platform.")
        let published: { readonly id: string; readonly url: string | null }
        if (platform === "facebook") {
          const accessToken = await decrypt(
            row.account.accessTokenEncrypted,
            config.tokenEncryptionKey,
            socialTokenSalt({
              organizationId: context.organizationId,
              platform,
              department: row.account.department,
            }),
          )
          let albumId: string | null = null
          if (row.target.facebookAlbumMode === "project_album") {
            const existingAlbum = await context.db.select().from(socialProjectAlbums).where(and(
              eq(socialProjectAlbums.accountId, row.account.id),
              eq(socialProjectAlbums.projectId, input.projectId),
            )).get()
            albumId = existingAlbum?.externalAlbumId ?? null
            if (!albumId) {
              const discoveredAlbum = await findFacebookAlbumByName({
                apiVersion: config.metaApiVersion,
                pageId: row.account.externalAccountId,
                accessToken,
                name: post.publicTitleSnapshot,
              })
              albumId = discoveredAlbum?.id ?? await createFacebookProjectAlbum({
                apiVersion: config.metaApiVersion,
                pageId: row.account.externalAccountId,
                accessToken,
                name: post.publicTitleSnapshot,
                description: `${post.publicTitleSnapshot} · ${post.locationCitySnapshot}`,
              })
              await context.db.insert(socialProjectAlbums).values({
                id: crypto.randomUUID(),
                accountId: row.account.id,
                projectId: input.projectId,
                externalAlbumId: albumId,
                albumName: discoveredAlbum?.name ?? post.publicTitleSnapshot,
                createdAt: now,
                updatedAt: now,
              }).onConflictDoUpdate({
                target: [
                  socialProjectAlbums.accountId,
                  socialProjectAlbums.projectId,
                ],
                set: {
                  externalAlbumId: albumId,
                  albumName: discoveredAlbum?.name ?? post.publicTitleSnapshot,
                  updatedAt: now,
                },
              }).run()
            }
          }
          published = await publishFacebookPhotos({
            apiVersion: config.metaApiVersion,
            pageId: row.account.externalAccountId,
            accessToken,
            text,
            photoUrls,
            albumId,
          })
        } else if (platform === "instagram") {
          const accessToken = await decrypt(
            row.account.accessTokenEncrypted,
            config.tokenEncryptionKey,
            socialTokenSalt({
              organizationId: context.organizationId,
              platform,
              department: row.account.department,
            }),
          )
          published = await publishInstagramPhotos({
            apiVersion: config.metaApiVersion,
            instagramAccountId: row.account.externalAccountId,
            accessToken,
            caption: text,
            photoUrls: instagramPhotoUrls,
          })
        } else {
          if (text.length > 280) throw new Error("X posts must be 280 characters or fewer.")
          if (mediaRows.length > 4) throw new Error("X supports up to four photos.")
          const accessToken = await xAccessToken({ context, account: row.account })
          const drive = await getOrganizationDriveContext({
            db: context.db,
            environment: context.env,
            organizationId: context.organizationId,
            user: context.user,
          })
          const mediaIds: string[] = []
          for (const media of mediaRows) {
            if (!media.driveFileId || !media.mimeType) throw new Error("A photo file is unavailable.")
            if ((media.fileSize ?? 0) > 5 * 1024 * 1024) {
              throw new Error("X image uploads are limited to 5 MB per photo.")
            }
            const response = await drive.client.downloadFile(drive.userEmail, media.driveFileId)
            if (!response.ok) throw new Error("A project photo could not be downloaded.")
            const bytes = new Uint8Array(await response.arrayBuffer())
            const sanitizedBytes = sanitizeSocialImage(bytes, media.mimeType)
            if (sanitizedBytes.byteLength > 5 * 1024 * 1024) {
              throw new Error("X image uploads are limited to 5 MB per photo.")
            }
            const mimeType = normalizeSocialImageMimeType(media.mimeType)
            if (!mimeType) throw new Error("A photo format is not supported for social publishing.")
            mediaIds.push(await uploadXImage({
              accessToken,
              bytes: sanitizedBytes,
              mimeType,
            }))
          }
          published = await publishXPost({ accessToken, text, mediaIds })
        }
        successes += 1
        await context.db.update(socialPostTargets).set({
          status: "published",
          externalPostId: published.id,
          externalPostUrl: published.url,
          error: null,
          publishedAt: now,
          updatedAt: now,
        }).where(eq(socialPostTargets.id, row.target.id)).run()
        await context.db.update(socialAccounts).set({
          lastPublishedAt: now,
          lastError: null,
          updatedAt: now,
        }).where(eq(socialAccounts.id, row.account.id)).run()
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "Publishing failed."
        await context.db.update(socialPostTargets).set({
          status: "failed",
          error: message,
          updatedAt: now,
        }).where(eq(socialPostTargets.id, row.target.id)).run()
        await context.db.update(socialAccounts).set({
          lastError: message,
          updatedAt: now,
        }).where(eq(socialAccounts.id, row.account.id)).run()
      }
    }
    const previouslyPublished = allTargets.filter(
      (row) => row.target.status === "published",
    ).length
    const totalPublished = previouslyPublished + successes
    const status = totalPublished === allTargets.length
      ? "published"
      : totalPublished > 0
        ? "partial"
        : "failed"
    await context.db.update(socialPosts).set({
      status,
      reviewedBy: context.user.id,
      reviewedAt: now,
      publishedAt: successes > 0 ? now : null,
      updatedAt: now,
    }).where(eq(socialPosts.id, post.id)).run()
    await recordActivityEvent({
      db: context.db,
      organizationId: context.organizationId,
      projectId: input.projectId,
      actor: context.user,
      category: "social",
      action: "social_post_publish_completed",
      entityType: "social_post",
      entityId: post.id,
      summary: `Social post “${post.heading}” published to ${totalPublished} of ${allTargets.length} destinations.`,
      metadata: { status, successfulDestinations: totalPublished, destinationCount: allTargets.length },
    })
    revalidateSocial(input.projectId)
    return successes > 0
      ? { success: true, postId: post.id }
      : { success: false, error: "Publishing failed for every destination. Review the destination errors and retry." }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to publish the social post.",
    }
  }
}

export async function deleteSocialPostDraft(input: {
  readonly projectId: string
  readonly postId: string
}): Promise<SocialResult> {
  try {
    const context = await socialContext(input.projectId, "delete")
    const post = await context.db.select({
      id: socialPosts.id,
      heading: socialPosts.heading,
      status: socialPosts.status,
    }).from(socialPosts).where(and(
      eq(socialPosts.id, input.postId),
      eq(socialPosts.projectId, input.projectId),
      eq(socialPosts.organizationId, context.organizationId),
      isNull(socialPosts.deletedAt),
    )).get()
    if (!post || post.status === "published" || post.status === "partial") {
      return { success: false, error: "Published posts remain in the audit history and cannot be deleted here." }
    }
    const now = new Date().toISOString()
    await context.db.update(socialPosts).set({
      status: "deleted",
      deletedAt: now,
      updatedAt: now,
    }).where(eq(socialPosts.id, post.id)).run()
    await recordActivityEvent({
      db: context.db,
      organizationId: context.organizationId,
      projectId: input.projectId,
      actor: context.user,
      category: "social",
      action: "social_post_deleted",
      entityType: "social_post",
      entityId: post.id,
      summary: `Removed social post draft “${post.heading}”.`,
    })
    revalidateSocial(input.projectId)
    return { success: true, postId: post.id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to delete the social post draft.",
    }
  }
}
