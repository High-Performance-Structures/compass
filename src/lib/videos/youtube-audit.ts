export type ProjectVideoAudience = "staff" | "owner" | "sub_vendor" | "public";
export type YoutubePrivacyStatus = "private" | "unlisted" | "public";

export function youtubePrivacyStatus(value: unknown): YoutubePrivacyStatus | null {
  if (value === "private" || value === "unlisted" || value === "public") {
    return value;
  }
  return null;
}

function environmentValue(env: unknown, key: string): string | null {
  const value =
    typeof env === "object" && env !== null
      ? Object.getOwnPropertyDescriptor(env, key)?.value
      : null;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  const processValue = process.env[key];
  return typeof processValue === "string" && processValue.trim().length > 0
    ? processValue.trim()
    : null;
}

export function isYoutubeApiAuditApproved(env: unknown): boolean {
  return environmentValue(env, "YOUTUBE_API_AUDIT_APPROVED") === "true";
}

export function youtubePrivacyForAudience(input: {
  readonly audience: ProjectVideoAudience;
  readonly auditApproved: boolean;
}): YoutubePrivacyStatus {
  if (input.audience === "public") return "public";
  if (input.audience === "staff" && !input.auditApproved) return "private";
  return "unlisted";
}
