import { describe, expect, it } from "vitest";

import {
  isYoutubeApiAuditApproved,
  youtubePrivacyForAudience,
} from "@/lib/videos/youtube-audit";

describe("YouTube API audit policy", () => {
  it("fails closed until Google approves the API project", () => {
    expect(isYoutubeApiAuditApproved({})).toBe(false);
    expect(
      youtubePrivacyForAudience({ audience: "staff", auditApproved: false }),
    ).toBe("private");
  });

  it("enables approved staff sharing without making it public", () => {
    expect(
      isYoutubeApiAuditApproved({ YOUTUBE_API_AUDIT_APPROVED: "true" }),
    ).toBe(true);
    expect(
      youtubePrivacyForAudience({ audience: "staff", auditApproved: true }),
    ).toBe("unlisted");
  });

  it("keeps invited audiences unlisted and explicit public videos public", () => {
    expect(
      youtubePrivacyForAudience({ audience: "owner", auditApproved: false }),
    ).toBe("unlisted");
    expect(
      youtubePrivacyForAudience({
        audience: "sub_vendor",
        auditApproved: false,
      }),
    ).toBe("unlisted");
    expect(
      youtubePrivacyForAudience({ audience: "public", auditApproved: false }),
    ).toBe("public");
  });
});
