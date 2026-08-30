Social Publishing
===

Compass can draft and publish privacy-safe project updates to department-specific Facebook Pages, linked professional Instagram accounts, and X accounts.

The module is deliberately review-first. AI can suggest a heading, body, and hashtags from approved project photos, but it cannot publish. Internal staff create and edit drafts; a user with `social-publishing.approve` must confirm the final public action.


workflow
---

1. An administrator connects Meta and X destinations for each department in Settings → Integrations.
2. Staff maintain a short `publicTitle` and a `publicLocationCity` on the project Information page. The location accepts a town/city only.
3. Photo review marks individual photos `approved` and `publicShareable`.
4. Staff open the project Social post page, choose destinations and photos, request or write copy, and create a draft.
5. Compass checks the draft for known client names, internal project names, site addresses, ZIP codes, and coordinates.
6. An approver reviews and confirms publishing. Destination results and errors are saved individually.
7. If no non-deleted social draft has been created since Monday, the dashboard Office priorities list reminds staff to create the weekly post.

Facebook posts can optionally use a project album. Compass reuses an existing department Page/project album or creates one using only the public project title.


approved destinations
---

Compass verifies the account identity returned by OAuth against this routing map before storing a connection:

| department | Facebook Page | Instagram | X |
|---|---|---|---|
| H | High Performance Structures, Inc. | `@hpscolorado` | `@HPSColorado` |
| N | Nu-Tech Systems | `@nutechcolorado` | `@NutechColorado` |
| O | Open Range Custom Builders | `@orconstructionltd` | `@ORConstruction` |
| D | Open Range Custom Builders | `@orconstructionltd` | `@ORConstruction` |


data and security
---

- OAuth access and refresh tokens are AES-GCM encrypted in D1 with `SOCIAL_TOKEN_ENCRYPTION_KEY` and organization/department/platform-bound additional authenticated data.
- Meta Page selection candidates are encrypted, user-bound, and expire after 15 minutes.
- Instagram requires Meta to fetch a public media URL. Compass creates an HMAC-signed photo URL that expires within 20 minutes. The route serves only photos that are still approved and public-shareable.
- Disconnecting an account overwrites the stored access token and clears refresh material while retaining the account row for post history and audit references.
- Publishing never includes the internal project name, client name, street address, GPS data, or raw photo metadata in the generated prompt.
- Published post IDs, links, per-destination errors, reviewer, and timestamps remain in the audit history.


provider setup
---

Meta requires a Business app, Facebook Login, managed Facebook Pages, and professional Instagram accounts linked to their Pages. Configure the production callback as:

`https://<compass-host>/api/social/meta/callback`

The integration requests `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. Production use may require Meta App Review and business verification. See Meta's maintained [Instagram API publishing collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

X requires a developer Project/App with OAuth 2.0 enabled and a callback of:

`https://<compass-host>/api/social/x/callback`

The integration requests `tweet.read`, `tweet.write`, `users.read`, `media.write`, and `offline.access`. See the official [OAuth 2.0 PKCE guide](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) and [Manage Posts documentation](https://docs.x.com/x-api/posts/manage-tweets/introduction).

Compass never accepts or stores X account passwords. Administrators sign in on X's authorization screen for each approved department profile, and Compass stores only the resulting encrypted OAuth tokens. Business profiles should use separate passwords and multi-factor authentication.


environment variables
---

| variable | purpose |
|---|---|
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | Required encryption/signing secret. Use a strong, independent production secret. |
| `SOCIAL_PUBLIC_BASE_URL` | Public Compass origin used for OAuth callbacks and short-lived photo URLs. |
| `META_APP_ID` | Meta app ID. |
| `META_APP_SECRET` | Meta app secret. |
| `META_GRAPH_API_VERSION` | Optional Graph API version; defaults to `v25.0`. |
| `X_CLIENT_ID` | X OAuth 2.0 client ID. |
| `X_CLIENT_SECRET` | Optional for public PKCE clients; required when configured as a confidential client. |
| `SOCIAL_AI_MODEL` | Optional OpenRouter vision-capable model; defaults to `google/gemini-2.5-flash`. |
| `OPENROUTER_API_KEY` | Enables photo-aware AI suggestions. Without it, Compass returns a deterministic privacy-safe starter draft. |


limits
---

- Instagram uses JPEG images and supports up to 10 carousel items.
- X supports up to four photos; Compass enforces 5 MB per image and 280 total text characters.
- Facebook project-album mode creates or reuses one album per Page and project.
- Provider permissions, rate limits, app-review status, and account eligibility are still enforced by Meta and X.
