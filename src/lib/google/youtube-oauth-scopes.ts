export const YOUTUBE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
] as const

const GOOGLE_SCOPE_EQUIVALENTS: Readonly<
  Record<string, readonly string[]>
> = {
  email: ["email", "https://www.googleapis.com/auth/userinfo.email"],
}

export function hasRequiredYoutubeScopes(scopes: readonly string[]): boolean {
  const granted = new Set(scopes)
  return YOUTUBE_OAUTH_SCOPES.every((scope) => {
    const equivalents = GOOGLE_SCOPE_EQUIVALENTS[scope] ?? [scope]
    return equivalents.some((candidate) => granted.has(candidate))
  })
}
